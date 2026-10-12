import { cardMethodFor, useAppStore } from '../useAppStore';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

describe('card kind learning', () => {
  it('defaults to corporate, then learns each card by its last digits', () => {
    expect(cardMethodFor(useAppStore.getState(), '5678')).toEqual({ method: 'corporate_card', known: false });
    useAppStore.getState().rememberCard('5678', 'personal_card');
    useAppStore.getState().rememberCard('1111', 'corporate_card');
    const s = useAppStore.getState();
    expect(cardMethodFor(s, '5678')).toEqual({ method: 'personal_card', known: true });
    expect(cardMethodFor(s, '1111')).toEqual({ method: 'corporate_card', known: true });
    // An unseen card or a receipt without digits takes the kind saved last.
    expect(cardMethodFor(s, '9999')).toEqual({ method: 'corporate_card', known: false });
  });

  it('ignores payments that are not cards', () => {
    useAppStore.getState().rememberCard('2222', 'cash');
    expect(useAppStore.getState().cardMethods['2222']).toBeUndefined();
  });
});
