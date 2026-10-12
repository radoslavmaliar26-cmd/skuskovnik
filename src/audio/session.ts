import { Store } from '../ui/hooks'

export interface RecorderState {
  active: boolean
  lectureId: string | null
}

export const recorderState = new Store<RecorderState>({ active: false, lectureId: null })
