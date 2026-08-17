import { appScopeSchema, knowledgeGenerationReferenceSchema } from "@data-agent/contracts";
import neo4j, { type Driver } from "neo4j-driver";
import { z } from "zod";
import {
  type KnowledgeIndex,
  KnowledgeIndexError,
  type KnowledgeIndexSealInput,
  type KnowledgeIndexSearchInput,
  type KnowledgeIndexStageInput,
} from "./knowledge-index.js";

const optionsSchema = z.strictObject({
  uri: z.url().refine((value) => !new URL(value).username && !new URL(value).password),
  username: z.string().min(1).max(256),
  password: z.string().min(1).max(4096),
  database: z.string().min(1).max(128).default("neo4j"),
  batch_size: z.number().int().min(10).max(5_000).default(500),
});

type Options = z.infer<typeof optionsSchema>;

function scopeParameters(scope: z.infer<typeof appScopeSchema>) {
  return { app_id: scope.app_id, tenant_id: scope.tenant_id, environment: scope.environment };
}

function mapError(error: unknown): never {
  if (error instanceof KnowledgeIndexError) throw error;
  throw new KnowledgeIndexError("INDEX_UNAVAILABLE", "Neo4j knowledge index is unavailable.");
}

function createAdapter(driver: Driver, options: Options): KnowledgeIndex {
  return Object.freeze({
    async initialize() {
      const session = driver.session({ database: options.database });
      try {
        await session.run(
          "create constraint knowledge_chunk_identity if not exists for (n:KnowledgeChunk) require (n.app_id,n.tenant_id,n.environment,n.generation_id,n.chunk_id) is unique",
        );
      } catch (error) {
        mapError(error);
      } finally {
        await session.close();
      }
    },

    async stage(input: KnowledgeIndexStageInput) {
      const parsed = z
        .strictObject({
          scope: appScopeSchema,
          build_id: z.uuid(),
          generation_ref: knowledgeGenerationReferenceSchema,
          manifest_hash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
          dimensions: z.number().int().min(2).max(16_384),
          chunks: z.array(
            z.strictObject({ chunk_id: z.uuid(), vector: z.array(z.number().finite()).min(2) }),
          ),
        })
        .parse(input);
      if (parsed.chunks.some((chunk) => chunk.vector.length !== parsed.dimensions)) {
        throw new KnowledgeIndexError(
          "INDEX_DIGEST_MISMATCH",
          "Knowledge vector dimensions differ.",
        );
      }
      const session = driver.session({ database: options.database });
      try {
        await session.executeWrite(async (transaction) => {
          const existing = await transaction.run(
            `match (n:KnowledgeChunk {app_id:$app_id,tenant_id:$tenant_id,environment:$environment,generation_id:$generation_id})
             return count(n) as total,
               count(case when n.sealed=true then 1 end) as sealed,
               count(case when n.sealed=true and n.generation_revision=$generation_revision
                 and n.generation_hash=$generation_hash and n.build_id=$build_id
                 and n.manifest_hash=$manifest_hash and n.dimensions=$dimensions
                 and n.chunk_id in $chunk_ids then 1 end) as matching`,
            {
              ...scopeParameters(parsed.scope),
              generation_id: parsed.generation_ref.generation_id,
              generation_revision: neo4j.int(parsed.generation_ref.generation_revision),
              generation_hash: parsed.generation_ref.generation_hash,
              build_id: parsed.build_id,
              manifest_hash: parsed.manifest_hash,
              dimensions: neo4j.int(parsed.dimensions),
              chunk_ids: parsed.chunks.map((chunk) => chunk.chunk_id),
            },
          );
          const totalValue = existing.records[0]?.get("total");
          const matchingValue = existing.records[0]?.get("matching");
          const sealedValue = existing.records[0]?.get("sealed");
          const total = neo4j.isInt(totalValue) ? totalValue.toNumber() : -1;
          const matching = neo4j.isInt(matchingValue) ? matchingValue.toNumber() : -1;
          const sealed = neo4j.isInt(sealedValue) ? sealedValue.toNumber() : -1;
          if (total === parsed.chunks.length && matching === parsed.chunks.length) return;
          if (sealed > 0) {
            throw new KnowledgeIndexError(
              "INDEX_DIGEST_MISMATCH",
              "Knowledge generation already contains a different sealed build.",
            );
          }
          await transaction.run(
            `match (n:KnowledgeChunk {app_id:$app_id,tenant_id:$tenant_id,environment:$environment,generation_id:$generation_id})
             where coalesce(n.sealed,false)=false delete n`,
            {
              ...scopeParameters(parsed.scope),
              generation_id: parsed.generation_ref.generation_id,
            },
          );
          for (let offset = 0; offset < parsed.chunks.length; offset += options.batch_size) {
            const rows = parsed.chunks.slice(offset, offset + options.batch_size);
            await transaction.run(
              `unwind $rows as row
               create (n:KnowledgeChunk {
                 app_id:$app_id,tenant_id:$tenant_id,environment:$environment,
                 generation_id:$generation_id,generation_revision:$generation_revision,
                 generation_hash:$generation_hash,build_id:$build_id,manifest_hash:$manifest_hash,
                 dimensions:$dimensions,chunk_id:row.chunk_id,vector:row.vector,sealed:false
               })`,
              {
                ...scopeParameters(parsed.scope),
                generation_id: parsed.generation_ref.generation_id,
                generation_revision: neo4j.int(parsed.generation_ref.generation_revision),
                generation_hash: parsed.generation_ref.generation_hash,
                build_id: parsed.build_id,
                manifest_hash: parsed.manifest_hash,
                dimensions: neo4j.int(parsed.dimensions),
                rows,
              },
            );
          }
        });
      } catch (error) {
        mapError(error);
      } finally {
        await session.close();
      }
    },

    async verifyAndSeal(input: KnowledgeIndexSealInput) {
      const session = driver.session({ database: options.database });
      try {
        return await session.executeWrite(async (transaction) => {
          const parameters = {
            ...scopeParameters(input.scope),
            generation_id: input.generation_ref.generation_id,
            generation_revision: neo4j.int(input.generation_ref.generation_revision),
            generation_hash: input.generation_ref.generation_hash,
            build_id: input.build_id,
            manifest_hash: input.manifest_hash,
            dimensions: neo4j.int(input.dimensions),
          };
          const counted = await transaction.run(
            `match (n:KnowledgeChunk {
               app_id:$app_id,tenant_id:$tenant_id,environment:$environment,generation_id:$generation_id,
               generation_revision:$generation_revision,generation_hash:$generation_hash,build_id:$build_id,
               manifest_hash:$manifest_hash,dimensions:$dimensions,sealed:false
             }) return count(n) as count`,
            parameters,
          );
          const countValue = counted.records[0]?.get("count");
          const count = neo4j.isInt(countValue) ? countValue.toNumber() : -1;
          if (count < 0) {
            throw new KnowledgeIndexError(
              "INDEX_DIGEST_MISMATCH",
              "Knowledge stage could not be verified.",
            );
          }
          await transaction.run(
            `match (old:KnowledgeChunk {app_id:$app_id,tenant_id:$tenant_id,environment:$environment,generation_id:$generation_id})
             where old.sealed=true set old.sealed=false`,
            parameters,
          );
          await transaction.run(
            `match (n:KnowledgeChunk {app_id:$app_id,tenant_id:$tenant_id,environment:$environment,
              generation_id:$generation_id,build_id:$build_id,manifest_hash:$manifest_hash})
             set n.sealed=true`,
            parameters,
          );
          return { chunk_count: count };
        });
      } catch (error) {
        mapError(error);
      } finally {
        await session.close();
      }
    },

    async search(input: KnowledgeIndexSearchInput) {
      const session = driver.session({
        database: options.database,
        defaultAccessMode: neo4j.session.READ,
      });
      try {
        const result = await session.run(
          `match (n:KnowledgeChunk {
             app_id:$app_id,tenant_id:$tenant_id,environment:$environment,
             generation_id:$generation_id,generation_revision:$generation_revision,
             generation_hash:$generation_hash,sealed:true
           })
           with n, vector.similarity.cosine(n.vector,$query_vector) as score
           order by score desc, n.chunk_id asc limit $limit
           return n.chunk_id as chunk_id, score`,
          {
            ...scopeParameters(input.scope),
            generation_id: input.generation_ref.generation_id,
            generation_revision: neo4j.int(input.generation_ref.generation_revision),
            generation_hash: input.generation_ref.generation_hash,
            query_vector: input.query_vector,
            limit: neo4j.int(input.limit),
          },
        );
        if (result.records.length === 0) {
          throw new KnowledgeIndexError("INDEX_NOT_READY", "Knowledge generation is not sealed.");
        }
        return result.records.map((record) => ({
          chunk_id: z.uuid().parse(record.get("chunk_id")),
          score: z.number().finite().min(-1).max(1).parse(record.get("score")),
        }));
      } catch (error) {
        mapError(error);
      } finally {
        await session.close();
      }
    },

    async cleanup(input: {
      readonly scope: z.infer<typeof appScopeSchema>;
      readonly knowledge_base_id: string;
      readonly keep_generation_ids: readonly string[];
    }) {
      const scope = appScopeSchema.parse(input.scope);
      const keep = z.array(z.uuid()).parse(input.keep_generation_ids);
      const session = driver.session({ database: options.database });
      try {
        const result = await session.run(
          `match (n:KnowledgeChunk {app_id:$app_id,tenant_id:$tenant_id,environment:$environment})
           where not n.generation_id in $keep detach delete n return count(n) as count`,
          { ...scopeParameters(scope), keep },
        );
        const value = result.records[0]?.get("count");
        return neo4j.isInt(value) ? value.toNumber() : 0;
      } catch (error) {
        mapError(error);
      } finally {
        await session.close();
      }
    },

    async close() {
      await driver.close();
    },
  });
}

export function createNeo4jKnowledgeIndex(input: unknown): KnowledgeIndex {
  const options = optionsSchema.parse(input);
  return createAdapter(
    neo4j.driver(options.uri, neo4j.auth.basic(options.username, options.password)),
    options,
  );
}

export function createNeo4jKnowledgeIndexFromEnvironment(
  environment: NodeJS.ProcessEnv,
): KnowledgeIndex {
  if (!environment.NEO4J_URI || !environment.NEO4J_USERNAME || !environment.NEO4J_PASSWORD) {
    throw new KnowledgeIndexError(
      "INDEX_NOT_CONFIGURED",
      "Neo4j knowledge index is not configured.",
    );
  }
  return createNeo4jKnowledgeIndex({
    uri: environment.NEO4J_URI,
    username: environment.NEO4J_USERNAME,
    password: environment.NEO4J_PASSWORD,
    database: environment.NEO4J_DATABASE ?? "neo4j",
    batch_size: Number(environment.NEO4J_KNOWLEDGE_BATCH_SIZE ?? 500),
  });
}
