import { useCallback } from 'react'
import { DomainError, type OpSummary, type OpType, type Tx } from '../core/index.ts'
import { errorText, useT } from '../context/i18n.tsx'
import { useFeedback } from '../context/feedback.tsx'
import { useStore } from '../context/store.tsx'
import { recordError } from '../lib/errors.ts'

export type CommitOutcome<T> = { ok: true; out: T; opId: string | null } | { ok: false; error: unknown }

export interface CommitOptions<T> {
  /** 成功提示；返回空串则不提示 */
  success?: string | ((out: NoInfer<T>) => string)
  /** 成功提示带「撤销」按钮（默认 true） */
  undoable?: boolean
  batchId?: string
  /** 失败时不弹提示（调用方自行展示） */
  silent?: boolean
}

/** 执行业务操作的统一入口：成功提示 + 撤销，失败把 DomainError 翻译成人话。 */
export function useCommit() {
  const store = useStore()
  const t = useT()
  const { toast } = useFeedback()

  const undo = useCallback(
    async (opId: string) => {
      try {
        await store.undo(opId)
        toast(t('common.undone'), { severity: 'info' })
      } catch (err) {
        if (!(err instanceof DomainError)) recordError(err)
        toast(errorText(t, err), { severity: 'error' })
      }
    },
    [store, t, toast],
  )

  const commit = useCallback(
    async <T>(
      type: OpType,
      summary: OpSummary | ((out: NoInfer<T>, tx: Tx) => OpSummary),
      fn: (tx: Tx) => T,
      opts: CommitOptions<NoInfer<T>> = {},
    ): Promise<CommitOutcome<T>> => {
      try {
        const { out, op } = await store.commit(type, summary, fn, { batchId: opts.batchId })
        const msg = typeof opts.success === 'function' ? opts.success(out) : opts.success
        if (msg) {
          toast(msg, op && opts.undoable !== false ? { action: { label: t('common.undo'), onClick: () => void undo(op.id) } } : {})
        }
        return { ok: true, out, opId: op?.id ?? null }
      } catch (err) {
        if (!(err instanceof DomainError)) recordError(err)
        if (!opts.silent) toast(errorText(t, err), { severity: 'error' })
        return { ok: false, error: err }
      }
    },
    [store, t, toast, undo],
  )

  return { commit, undo }
}
