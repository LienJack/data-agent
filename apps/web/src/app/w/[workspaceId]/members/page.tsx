import Link from "next/link";

export default function WorkspaceMembersPage() {
  return (
    <section className="mx-auto max-w-5xl p-6">
      <h1 className="text-lg font-semibold">工作空间成员</h1>
      <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
        成员角色由 PostgreSQL identity authority 管理；当前入口只接受已有用户，不开放自主注册。
      </p>
      <Link href="/settings" className="mt-4 inline-block text-sm text-blue-600 hover:underline">
        打开管理员设置
      </Link>
    </section>
  );
}
