import { create } from 'zustand';
import type { TopRightAdState } from '../types/topRightAd';
import { forceRefreshTopRightAdState, getTopRightAdState } from '../services/topRightAdService';

const EMPTY_STATE: TopRightAdState = {
  ad: null,
  ads: [],
};

const TOP_RIGHT_AD_STATE_CACHE_KEYS = [
  'agtools.top_right_ad_state.cache.v1',
  'agtools.top_right_ad_state.cache.v2',
];

interface TopRightAdStoreState {
  state: TopRightAdState;
  loading: boolean;
  initialized: boolean;
  fetchState: () => Promise<TopRightAdState>;
  forceRefreshState: () => Promise<TopRightAdState>;
}

function normalizeTopRightAdState(state: TopRightAdState): TopRightAdState {
  return {
    ad: state.ad ?? state.ads?.[0] ?? null,
    ads: Array.isArray(state.ads) ? state.ads : [],
  };
}

function loadCachedTopRightAdState(): TopRightAdState {
  if (typeof localStorage === 'undefined') {
    return EMPTY_STATE;
  }

  try {
    for (const key of TOP_RIGHT_AD_STATE_CACHE_KEYS) {
      localStorage.removeItem(key);
    }
    return EMPTY_STATE;
  } catch {
    return EMPTY_STATE;
  }
}

function clearTopRightAdStateCache(): void {
  if (typeof localStorage === 'undefined') {
    return;
  }

  try {
    for (const key of TOP_RIGHT_AD_STATE_CACHE_KEYS) {
      localStorage.removeItem(key);
    }
  } catch {
    // 缓存写入失败不影响主流程。
  }
}

const initialTopRightAdState = loadCachedTopRightAdState();

export const useTopRightAdStore = create<TopRightAdStoreState>((set, get) => ({
  state: initialTopRightAdState,
  loading: false,
  initialized: initialTopRightAdState.ads.length > 0,

  fetchState: async () => {
    set({ loading: true });
    try {
      const nextState = normalizeTopRightAdState(await getTopRightAdState());
      set({ state: nextState, loading: false, initialized: true });
      clearTopRightAdStateCache();
      return nextState;
    } catch (error) {
      console.error('加载右上角广告位失败:', error);
      const currentState = get().state;
      set({ state: currentState, loading: false, initialized: true });
      return currentState;
    }
  },

  forceRefreshState: async () => {
    set({ loading: true });
    try {
      const nextState = normalizeTopRightAdState(await forceRefreshTopRightAdState());
      set({ state: nextState, loading: false, initialized: true });
      clearTopRightAdStateCache();
      return nextState;
    } catch (error) {
      console.error('强制刷新右上角广告位失败:', error);
      const currentState = get().state;
      set({ state: currentState, loading: false, initialized: true });
      return currentState;
    }
  },
}));
