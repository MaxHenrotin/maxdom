import { describe, expect, it } from 'vitest';
import { categorize } from '../src/categories.js';

describe('categorize', () => {
  it('puts stopped shows in stopped once an episode was seen', () => {
    expect(categorize({ stopped: true, status: 'Ended', seen: 10, airedUnseen: 0 })).toBe('stopped');
  });

  it('puts shows with nothing seen in watch_later, even when stopped', () => {
    expect(categorize({ stopped: true, status: 'Ended', seen: 0, airedUnseen: 8 })).toBe('watch_later');
  });

  it('puts shows with nothing seen in watch_later', () => {
    expect(categorize({ stopped: false, status: 'Running', seen: 0, airedUnseen: 5 })).toBe('watch_later');
  });

  it('puts shows without any episode in watch_later', () => {
    expect(categorize({ stopped: false, status: 'In Development', seen: 0, airedUnseen: 0 })).toBe('watch_later');
  });

  it('puts started shows with aired episodes left in in_progress', () => {
    expect(categorize({ stopped: false, status: 'Ended', seen: 3, airedUnseen: 2 })).toBe('in_progress');
  });

  it('puts fully seen ended shows in ended', () => {
    expect(categorize({ stopped: false, status: 'Ended', seen: 10, airedUnseen: 0 })).toBe('ended');
  });

  it('puts fully seen shows that have not ended in waiting', () => {
    expect(categorize({ stopped: false, status: 'Running', seen: 10, airedUnseen: 0 })).toBe('waiting');
    expect(categorize({ stopped: false, status: 'To Be Determined', seen: 10, airedUnseen: 0 })).toBe('waiting');
  });
});
