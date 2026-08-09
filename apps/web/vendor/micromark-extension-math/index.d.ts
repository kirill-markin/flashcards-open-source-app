export {math} from './lib/syntax.js'

export interface Options {
  singleDollarTextMath?: boolean | null | undefined
}

declare module 'micromark-util-types' {
  interface TokenTypeMap {
    mathFlow: 'mathFlow'
    mathFlowFence: 'mathFlowFence'
    mathFlowFenceMeta: 'mathFlowFenceMeta'
    mathFlowFenceSequence: 'mathFlowFenceSequence'
    mathFlowValue: 'mathFlowValue'
    mathText: 'mathText'
    mathTextData: 'mathTextData'
    mathTextPadding: 'mathTextPadding'
    mathTextSequence: 'mathTextSequence'
  }
}
