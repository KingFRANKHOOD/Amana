import { renderHook, act } from '@testing-library/react';
import { TradeProvider, useTrade } from '../TradeContext';

describe('TradeContext', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
        <TradeProvider>{children}</TradeProvider>
    );

    describe('initialization', () => {
        it('should initialize with default values', () => {
            const { result } = renderHook(() => useTrade(), { wrapper });

            expect(result.current.step).toBe(1);
            expect(result.current.data).toEqual({
                commodity: '',
                quantity: '',
                unit: 'kg',
                pricePerUnit: '',
                currency: 'NGN',
                sellerAddress: '',
                buyerRatio: 50,
                sellerRatio: 50,
                deliveryDays: '7',
                notes: '',
            });
        });

        it('should provide setStep function', () => {
            const { result } = renderHook(() => useTrade(), { wrapper });

            expect(typeof result.current.setStep).toBe('function');
        });

        it('should provide update function', () => {
            const { result } = renderHook(() => useTrade(), { wrapper });

            expect(typeof result.current.update).toBe('function');
        });
    });

    describe('step progression', () => {
        it('should update step to 2', () => {
            const { result } = renderHook(() => useTrade(), { wrapper });

            act(() => {
                result.current.setStep(2);
            });

            expect(result.current.step).toBe(2);
        });

        it('should update step to 3', () => {
            const { result } = renderHook(() => useTrade(), { wrapper });

            act(() => {
                result.current.setStep(3);
            });

            expect(result.current.step).toBe(3);
        });

        it('should allow going back to previous steps', () => {
            const { result } = renderHook(() => useTrade(), { wrapper });

            act(() => {
                result.current.setStep(3);
            });
            expect(result.current.step).toBe(3);

            act(() => {
                result.current.setStep(1);
            });
            expect(result.current.step).toBe(1);
        });
    });

    describe('update function', () => {
        it('should update single field', () => {
            const { result } = renderHook(() => useTrade(), { wrapper });

            act(() => {
                result.current.update({ commodity: 'Maize' });
            });

            expect(result.current.data.commodity).toBe('Maize');
            expect(result.current.data.quantity).toBe('');
        });

        it('should update multiple fields at once', () => {
            const { result } = renderHook(() => useTrade(), { wrapper });

            act(() => {
                result.current.update({
                    commodity: 'Rice',
                    quantity: '500',
                    pricePerUnit: '450',
                });
            });

            expect(result.current.data.commodity).toBe('Rice');
            expect(result.current.data.quantity).toBe('500');
            expect(result.current.data.pricePerUnit).toBe('450');
        });

        it('should preserve existing fields when updating', () => {
            const { result } = renderHook(() => useTrade(), { wrapper });

            act(() => {
                result.current.update({ commodity: 'Maize' });
            });

            act(() => {
                result.current.update({ quantity: '100' });
            });

            expect(result.current.data.commodity).toBe('Maize');
            expect(result.current.data.quantity).toBe('100');
        });

        it('should update buyerRatio and sellerRatio independently', () => {
            const { result } = renderHook(() => useTrade(), { wrapper });

            act(() => {
                result.current.update({ buyerRatio: 70 });
            });

            expect(result.current.data.buyerRatio).toBe(70);
            expect(result.current.data.sellerRatio).toBe(50);
        });

        it('should update sellerAddress', () => {
            const { result } = renderHook(() => useTrade(), { wrapper });

            act(() => {
                result.current.update({ sellerAddress: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ012345678901234567890' });
            });

            expect(result.current.data.sellerAddress).toBe('GABCDEFGHIJKLMNOPQRSTUVWXYZ012345678901234567890');
        });

        it('should update deliveryDays', () => {
            const { result } = renderHook(() => useTrade(), { wrapper });

            act(() => {
                result.current.update({ deliveryDays: '14' });
            });

            expect(result.current.data.deliveryDays).toBe('14');
        });

        it('should update notes', () => {
            const { result } = renderHook(() => useTrade(), { wrapper });

            act(() => {
                result.current.update({ notes: 'Goods must be bagged and sealed' });
            });

            expect(result.current.data.notes).toBe('Goods must be bagged and sealed');
        });

        it('should update currency', () => {
            const { result } = renderHook(() => useTrade(), { wrapper });

            act(() => {
                result.current.update({ currency: 'USDC' });
            });

            expect(result.current.data.currency).toBe('USDC');
        });

        it('should update unit', () => {
            const { result } = renderHook(() => useTrade(), { wrapper });

            act(() => {
                result.current.update({ unit: 'tonnes' });
            });

            expect(result.current.data.unit).toBe('tonnes');
        });
    });

    describe('edge cases', () => {
        it('should handle empty string updates', () => {
            const { result } = renderHook(() => useTrade(), { wrapper });

            act(() => {
                result.current.update({ commodity: 'Maize' });
            });

            act(() => {
                result.current.update({ commodity: '' });
            });

            expect(result.current.data.commodity).toBe('');
        });

        it('should handle null-like values in strings', () => {
            const { result } = renderHook(() => useTrade(), { wrapper });

            act(() => {
                result.current.update({ quantity: '0' });
            });

            expect(result.current.data.quantity).toBe('0');
        });

        it('should handle very large numbers as strings', () => {
            const { result } = renderHook(() => useTrade(), { wrapper });

            act(() => {
                result.current.update({ quantity: '999999999' });
            });

            expect(result.current.data.quantity).toBe('999999999');
        });

        it('should handle negative numbers as strings', () => {
            const { result } = renderHook(() => useTrade(), { wrapper });

            act(() => {
                result.current.update({ quantity: '-100' });
            });

            expect(result.current.data.quantity).toBe('-100');
        });

        it('should handle boundary values for ratios', () => {
            const { result } = renderHook(() => useTrade(), { wrapper });

            act(() => {
                result.current.update({ buyerRatio: 0 });
            });
            expect(result.current.data.buyerRatio).toBe(0);

            act(() => {
                result.current.update({ buyerRatio: 100 });
            });
            expect(result.current.data.buyerRatio).toBe(100);
        });
    });
});
