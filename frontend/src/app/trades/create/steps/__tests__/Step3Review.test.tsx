import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Step3Review } from '../Step3Review';
import { tradesApi } from '@/lib/api/trades';

jest.mock('@/lib/api/trades', () => ({
  tradesApi: {
    create: jest.fn(),
  },
}));

const mockedCreate = tradesApi.create as jest.MockedFunction<typeof tradesApi.create>;

describe('Step3Review', () => {
  const data = {
    sellerAddress: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUV',
    amountCngn: '100.0000000',
    buyerLossBps: 5000,
    sellerLossBps: 5000,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('sends amountUsdc (not amountCngn) in the create-trade request body', async () => {
    mockedCreate.mockResolvedValue({ id: 'trade-1' } as never);
    const onSuccess = jest.fn();

    render(<Step3Review data={data} onBack={jest.fn()} onSuccess={onSuccess} />);

    await userEvent.click(screen.getByRole('button', { name: /create trade/i }));

    await waitFor(() => expect(mockedCreate).toHaveBeenCalledTimes(1));

    const payload = mockedCreate.mock.calls[0][0];
    expect(payload).toEqual({
      sellerAddress: data.sellerAddress,
      amountUsdc: data.amountCngn,
      buyerLossBps: data.buyerLossBps,
      sellerLossBps: data.sellerLossBps,
    });
    expect(payload).not.toHaveProperty('amountCngn');
    expect(onSuccess).toHaveBeenCalledWith('trade-1');
  });
});
