import { liveQuery } from 'dexie'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { db, mergeSettings } from '../db/db'
import type { Settings } from '../db/types'

/** Reaktívny dotaz do IndexedDB (prekreslí sa pri zmene dát). */
export function useLive<T>(fn: () => Promise<T>, deps: unknown[]): T | undefined {
  const [value, setValue] = useState<T | undefined>(undefined)
  useEffect(() => {
    const sub = liveQuery(fn).subscribe({
      next: (v) => setValue(v),
      error: (e) => console.error('liveQuery', e),
    })
    return () => sub.unsubscribe()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return value
}

export function useSettings(): Settings | undefined {
  return useLive(async () => mergeSettings(await db.settings.get('app')), [])
}

/** Jednoduchý globálny „store“ s odberom (pre singletony mimo Reactu). */
export class Store<T> {
  private listeners = new Set<() => void>()
  private value: T
  constructor(value: T) {
    this.value = value
  }
  get = () => this.value
  set = (v: T | ((prev: T) => T)) => {
    this.value = typeof v === 'function' ? (v as (p: T) => T)(this.value) : v
    this.listeners.forEach((l) => l())
  }
  subscribe = (l: () => void) => {
    this.listeners.add(l)
    return () => {
      this.listeners.delete(l)
    }
  }
}

export function useStore<T>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.get, store.get)
}

export function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine)
  useEffect(() => {
    const on = () => setOnline(navigator.onLine)
    window.addEventListener('online', on)
    window.addEventListener('offline', on)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', on)
    }
  }, [])
  return online
}
