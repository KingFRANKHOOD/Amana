import { fireEvent, render, screen } from "@testing-library/react";
import { WalletAddressBadge } from "../WalletAddressBadge";

describe("WalletAddressBadge", () => {
  const address = "GBRPYHIL2CI3BFFWUW6A4HNE2ON4ZVQ4V4SZW4QFWK3DEMO1234";

  it("renders truncated address with copy action", () => {
    render(<WalletAddressBadge address={address} showCopy showExplorer={false} />);

    expect(screen.getByText("GBRPYH...1234")).toBeInTheDocument();
    expect(screen.getByLabelText("Copy wallet address")).toBeInTheDocument();
  });

  it("renders explorer URL for selected network", () => {
    render(
      <WalletAddressBadge
        address={address}
        showCopy={false}
        showExplorer
        explorerNetwork="public"
      />,
    );

    expect(screen.getByLabelText("Open wallet in Stellar Expert")).toHaveAttribute(
      "href",
      `https://stellar.expert/explorer/public/account/${address}`,
    );
  });

  it("triggers clipboard write on copy click", () => {
    const writeText = jest.fn();
    Object.assign(navigator, {
      clipboard: { writeText },
    });

    render(<WalletAddressBadge address={address} showCopy showExplorer={false} />);
    fireEvent.click(screen.getByLabelText("Copy wallet address"));

    expect(writeText).toHaveBeenCalledWith(address);
  });
});
