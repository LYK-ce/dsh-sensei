/**
 * 标记闭联合里不可达的分支。
 * @param value - 类型系统已经排除的值；传入可达变体时在调用点报错。
 * @returns 不会返回；运行时出现越界值必然抛错。
 */
export function assertNever(value: never): never {
  throw new Error(`unreachable variant: ${JSON.stringify(value)}`)
}
