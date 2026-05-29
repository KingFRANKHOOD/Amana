import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NavButton, NavLink } from "../Navigation";

describe("Navigation UI", () => {
  it("renders a link with active styles and aria-current when active", () => {
    render(
      <NavLink href="/dashboard" isActive>
        Dashboard
      </NavLink>,
    );

    const link = screen.getByRole("link", { name: "Dashboard" });
    expect(link).toHaveAttribute("href", "/dashboard");
    expect(link).toHaveAttribute("aria-current", "page");
    expect(link).toHaveClass("bg-surface-2");
    expect(link).toHaveClass("text-gold");
  });

  it("renders a button with inactive styles and focus-visible outline", async () => {
    const user = userEvent.setup();
    render(
      <NavButton type="button" isActive={false}>
        Active Filter
      </NavButton>,
    );

    const button = screen.getByRole("button", { name: "Active Filter" });
    expect(button).toHaveClass("text-text-secondary");
    expect(button).toHaveClass("hover:text-text-primary");

    await user.tab();
    expect(button).toHaveFocus();
  });
});
