import { describe, expect, it } from 'vitest';
import { pickShowsToRefresh } from '../src/refresh.js';

describe('pickShowsToRefresh', () => {
  const myShows = [{ id: 1, tvmaze_updated: 100 }, { id: 2, tvmaze_updated: 50 }, { id: 3, tvmaze_updated: 10 }];
  const updates = { 1: 100, 2: 60, 3: 20, 99: 500 };

  it('picks my shows updated since the last fetch, oldest first', () => {
    expect(pickShowsToRefresh(myShows, updates)).toEqual([3, 2]);
  });

  it('stops at the limit', () => {
    expect(pickShowsToRefresh(myShows, updates, 1)).toEqual([3]);
  });
});
