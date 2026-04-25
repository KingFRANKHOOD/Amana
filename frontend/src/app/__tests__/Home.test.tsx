import { render, screen } from "@testing-library/react";
import Home from "../page";

describe("Home", () => {
  it("presents the product entry points without linking to missing dashboard routes", () => {
    render(<Home />);

    expect(screen.getByRole("heading", { name: "Amana" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /start trade/i })).toHaveAttribute(
      "href",
      "/trades/create"
    );
    expect(screen.getByRole("link", { name: /open workspace/i })).toHaveAttribute(
      "href",
      "/assets"
    );
    expect(screen.queryByRole("link", { name: /dashboard/i })).not.toBeInTheDocument();
  });

  it("surfaces the escrow workflow for buyers, sellers, and mediators", () => {
    render(<Home />);

    expect(screen.getByText("Create a trade")).toBeInTheDocument();
    expect(screen.getByText("Track vault activity")).toBeInTheDocument();
    expect(screen.getByText("Resolve disputes")).toBeInTheDocument();
    expect(screen.getByText("Evidence packet")).toBeInTheDocument();
  });
});
