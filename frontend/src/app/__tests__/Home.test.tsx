import { render, screen } from "@testing-library/react";
import Home from "../page";

jest.mock("@/components/landing/LandingCtaButtons", () => ({
  LandingCtaButtons: () => <div data-testid="landing-cta-buttons" />,
}));

describe("Home", () => {
  it("presents the product entry points without linking to missing dashboard routes", () => {
    render(<Home />);

    expect(screen.getByRole("heading", { name: /agricultural trade/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /start a trade/i })).toHaveAttribute(
      "href",
      "/trades/create"
    );
    expect(screen.getByRole("link", { name: /open dashboard/i })).toHaveAttribute(
      "href",
      "/dashboard"
    );
  });

  it("surfaces the escrow workflow for buyers, sellers, and mediators", () => {
    render(<Home />);

    expect(screen.getByText("Create a trade")).toBeInTheDocument();
    expect(screen.getByText("Track delivery")).toBeInTheDocument();
    expect(screen.getByText("Verify & complete")).toBeInTheDocument();
    expect(screen.getByText("Evidence-backed disputes")).toBeInTheDocument();
  });
});
