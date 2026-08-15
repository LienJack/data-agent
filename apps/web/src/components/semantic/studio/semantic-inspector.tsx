"use client";

import type { SemanticGraphReadEdge, SemanticGraphReadNode } from "@data-agent/contracts";
import { ArrowRight, BracketsCurly, CirclesThree, Sparkle, X } from "@phosphor-icons/react";
import { motion } from "framer-motion";
import {
  edgeLabel,
  SEMANTIC_NODE_PRESENTATION,
  SEMANTIC_STATUS_PRESENTATION,
} from "@/lib/semantic-studio-model";

function AttributeRows({ edge }: { readonly edge: SemanticGraphReadEdge }) {
  return (
    <div className="divide-y divide-[#e3e8e5] border-y border-[#d7ddd9]">
      {Object.entries(edge.edge.attributes).map(([key, value]) => (
        <div key={key} className="grid grid-cols-[104px_minmax(0,1fr)] gap-3 py-2.5 text-[10px]">
          <span className="break-words font-mono text-[#7b8781]">{key}</span>
          <span className="break-words text-right font-mono leading-4 text-[#44514b]">
            {typeof value === "string" ? value : JSON.stringify(value)}
          </span>
        </div>
      ))}
    </div>
  );
}

export function SemanticInspector({
  node,
  edge,
  onAskAgent,
  onClose,
}: {
  readonly node: SemanticGraphReadNode | null;
  readonly edge: SemanticGraphReadEdge | null;
  readonly onAskAgent: (draft: string) => void;
  readonly onClose: () => void;
}) {
  const selected = node ?? edge;

  return (
    <motion.aside
      id="semantic-studio-inspector"
      layout
      className="border border-[#d7ddd9] bg-white shadow-[0_12px_34px_rgba(38,52,45,0.04)] xl:sticky xl:top-3"
      aria-label="节点或关系详情"
    >
      {!selected ? (
        <div className="min-h-[320px] px-5 py-6 xl:min-h-[620px]">
          <div className="flex items-center gap-2 border-b border-[#d7ddd9] pb-4">
            <CirclesThree className="size-4 text-[#356b5a]" aria-hidden="true" />
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#6f7b75]">
              Context inspector
            </p>
          </div>
          <div className="flex min-h-[240px] flex-col justify-center">
            <p className="text-sm font-semibold tracking-[-0.01em] text-[#2c3732]">
              选择一个 Node 或 Edge
            </p>
            <p className="mt-2 max-w-[250px] text-[11px] leading-5 text-[#738079]">
              在节点目录或 G6 图中选择对象，这里会显示固有属性、方向、证据与候选状态。
            </p>
            <div className="mt-6 border-l-2 border-[#c2d2cb] pl-3 text-[10px] leading-4 text-[#748079]">
              关系检查器只读取权威投影；修改动作会把当前上下文交给 Agent。
            </div>
          </div>
        </div>
      ) : (
        <motion.div initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }}>
          <div className="flex items-start justify-between gap-3 border-b border-[#d7ddd9] px-5 py-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#6d7973]">
                <span>{node ? "Node" : "Edge"}</span>
                <span className="text-[#a1aaa5]">/</span>
                <span style={{ color: SEMANTIC_STATUS_PRESENTATION[selected.status].color }}>
                  {SEMANTIC_STATUS_PRESENTATION[selected.status].label}
                </span>
              </div>
              <h2 className="mt-2 truncate text-[15px] font-semibold tracking-[-0.02em] text-[#26312d]">
                {node?.node.name ?? (edge ? edgeLabel(edge) : "")}
              </h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="grid size-8 shrink-0 place-items-center text-[#718078] transition-colors hover:bg-[#f0f3f1] hover:text-[#26312d]"
              aria-label="关闭详情"
              title="关闭详情"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>

          <div className="px-5 py-5">
            {node ? (
              <>
                <div className="flex items-center gap-3">
                  <span
                    className="grid size-10 shrink-0 place-items-center rounded-full text-[10px] font-semibold"
                    style={{
                      backgroundColor: SEMANTIC_NODE_PRESENTATION[node.node.node_type].fill,
                      color: SEMANTIC_NODE_PRESENTATION[node.node.node_type].text,
                    }}
                  >
                    {SEMANTIC_NODE_PRESENTATION[node.node.node_type].short}
                  </span>
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.12em] text-[#7b8781]">
                      对象类型
                    </p>
                    <p className="mt-1 text-xs font-medium text-[#34413b]">
                      {SEMANTIC_NODE_PRESENTATION[node.node.node_type].label}
                    </p>
                  </div>
                </div>

                <div className="mt-6 border-y border-[#d7ddd9] py-4">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.13em] text-[#7a8680]">
                    定义
                  </p>
                  <p className="mt-2 text-[11px] leading-5 text-[#59665f]">
                    {node.node.node_type === "GLOSSARY_TERM"
                      ? node.node.definition
                      : node.node.description || "尚未补充定义"}
                  </p>
                </div>

                <div className="grid grid-cols-2 divide-x divide-[#d7ddd9] border-b border-[#d7ddd9]">
                  <div className="py-4 pr-4">
                    <p className="text-[10px] uppercase tracking-wide text-[#7b8781]">版本</p>
                    <p className="mt-1 font-mono text-xs text-[#35423c]">
                      v{node.node.node_version}
                    </p>
                  </div>
                  <div className="py-4 pl-4">
                    <p className="text-[10px] uppercase tracking-wide text-[#7b8781]">关系</p>
                    <p className="mt-1 font-mono text-xs text-[#35423c]">
                      {node.relation_count.incoming} 入 / {node.relation_count.outgoing} 出
                    </p>
                  </div>
                </div>

                <dl className="mt-5 space-y-4 text-[10px]">
                  <div>
                    <dt className="uppercase tracking-wide text-[#7b8781]">Owner</dt>
                    <dd className="mt-1 font-mono text-[11px] text-[#48554f]">
                      {node.node.owner_ref}
                    </dd>
                  </div>
                  {node.node.node_type === "GLOSSARY_TERM" ? (
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <dt className="uppercase tracking-wide text-[#7b8781]">术语类别</dt>
                        <dd className="mt-1 font-mono text-[11px] text-[#48554f]">
                          {node.node.term_kind}
                        </dd>
                      </div>
                      <div>
                        <dt className="uppercase tracking-wide text-[#7b8781]">语言</dt>
                        <dd className="mt-1 font-mono text-[11px] text-[#48554f]">
                          {node.node.language}
                        </dd>
                      </div>
                    </div>
                  ) : null}
                  <div>
                    <dt className="uppercase tracking-wide text-[#7b8781]">稳定 ID</dt>
                    <dd className="mt-1 break-all font-mono leading-4 text-[#5e6a64]">
                      {node.node.node_id}
                    </dd>
                  </div>
                </dl>
              </>
            ) : edge ? (
              <>
                <div className="grid grid-cols-2 gap-4 border-b border-[#d7ddd9] pb-4 text-[10px]">
                  <div>
                    <p className="uppercase tracking-wide text-[#7b8781]">关系类型</p>
                    <p className="mt-1 font-mono text-[11px] font-semibold text-[#35423c]">
                      {edge.edge.edge_type}
                    </p>
                  </div>
                  <div>
                    <p className="uppercase tracking-wide text-[#7b8781]">关系家族</p>
                    <p className="mt-1 font-mono text-[11px] text-[#35423c]">{edge.edge.family}</p>
                  </div>
                </div>
                <div className="py-5">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.13em] text-[#7a8680]">
                    规范方向
                  </p>
                  <div className="mt-3 flex items-center gap-2 text-[10px] text-[#48554f]">
                    <span className="min-w-0 flex-1 break-all border border-[#d7ddd9] bg-[#f8faf8] p-2 font-mono leading-4">
                      {edge.edge.source_node_id}
                    </span>
                    <ArrowRight className="size-4 shrink-0 text-[#356b5a]" aria-hidden="true" />
                    <span className="min-w-0 flex-1 break-all border border-[#d7ddd9] bg-[#f8faf8] p-2 font-mono leading-4">
                      {edge.edge.target_node_id}
                    </span>
                  </div>
                </div>
                <div>
                  <div className="mb-3 flex items-center gap-2">
                    <BracketsCurly className="size-4 text-[#356b5a]" aria-hidden="true" />
                    <p className="text-[10px] font-semibold uppercase tracking-[0.13em] text-[#7a8680]">
                      关系属性
                    </p>
                  </div>
                  <AttributeRows edge={edge} />
                </div>
              </>
            ) : null}

            <button
              type="button"
              onClick={() =>
                onAskAgent(
                  node
                    ? `修改「${node.node.name}」：`
                    : `修改关系「${edge ? edgeLabel(edge) : ""}」：`,
                )
              }
              className="mt-6 inline-flex h-10 w-full items-center justify-center gap-2 bg-[#356b5a] px-3 text-xs font-semibold text-white transition-colors hover:bg-[#285b4b] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#356b5a]"
            >
              <Sparkle className="size-4" weight="fill" aria-hidden="true" />让 Agent 修改
            </button>
            <p className="mt-2 text-[10px] leading-4 text-[#748079]">
              只提交编辑意图，不直接写 Node 或 Edge。
            </p>
          </div>
        </motion.div>
      )}
    </motion.aside>
  );
}
