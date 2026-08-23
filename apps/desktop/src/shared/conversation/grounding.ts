import type { ActionReplyGrounding } from '../actions'
import type { ProjectReplyProvenance } from '../project-awareness'

/** Immutable, turn-scoped facts actually used to produce one assistant reply. */
export interface ReplyGrounding {
  project?: ProjectReplyProvenance
  action?: ActionReplyGrounding
}
