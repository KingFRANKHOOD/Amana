import React from "react";
import { render, screen } from "@testing-library/react";
import { TimelineItem } from "../TimelineItem";

const base = {
  event: "Funds Deposited",
  timestamp: "2024-06-15T14:30:00.000Z",
  status: "completed" as const,
};

describe("TimelineItem", () => {
  it("renders event label and formatted timestamp", () => {
    render(<TimelineItem {...base} />);
    expect(screen.getByText("Funds Deposited")).toBeInTheDocument();
    expect(screen.getByText(/Jun 15, 2024/)).toBeInTheDocument();
  });

  it("uses active title styling and gold pulse marker", () => {
    const { container } = render(<TimelineItem {...base} status="active" />);
    const title = screen.getByText("Funds Deposited");
    expect(title.className).toMatch(/font-semibold/);
    expect(title.className).toMatch(/text-text-primary/);
    expect(container.querySelector(".bg-gold.animate-pulse")).toBeInTheDocument();
  });

  it("renders completed emerald dot", () => {
    const { container } = render(<TimelineItem {...base} status="completed" />);
    expect(container.querySelector(".bg-accent-emerald")).toBeInTheDocument();
  });

  it("renders pending ring marker", () => {
    const { container } = render(<TimelineItem {...base} status="pending" />);
    const ring = container.querySelector(
      ".border-2.border-border-default.rounded-full",
    );
    expect(ring).toBeInTheDocument();
  });

  it("renders connector when not last", () => {
    const { container } = render(<TimelineItem {...base} isLast={false} />);
    const line = container.querySelector(
      ".absolute.top-3.left-1\\.5.w-0\\.5.min-h-\\[40px\\].bg-border-default",
    );
    expect(line).toBeInTheDocument();
  });

  it("omits connector when last", () => {
    const { container } = render(<TimelineItem {...base} isLast />);
    expect(
      container.querySelector(".min-h-\\[40px\\].bg-border-default"),
    ).not.toBeInTheDocument();
  });

  it("renders optional detail and actor", () => {
    render(
      <TimelineItem
        {...base}
        detail="Wire transfer cleared."
        actor="System"
      />,
    );
    expect(screen.getByText("Wire transfer cleared.")).toBeInTheDocument();
    expect(screen.getByText("System")).toBeInTheDocument();
  });

  it("sets time element dateTime from ISO string", () => {
    render(<TimelineItem {...base} timestamp="2024-01-02T12:00:00.000Z" />);
    expect(screen.getByRole("time")).toHaveAttribute(
      "dateTime",
      "2024-01-02T12:00:00.000Z",
    );
  });
});
