import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ErrorState } from "../ErrorState";

describe("ErrorState", () => {
  it("renders default error state", () => {
    render(<ErrorState />);
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(screen.getByText(/Please try again/)).toBeInTheDocument();
  });

  it("renders custom title and message", () => {
    render(<ErrorState title="Custom Title" message="Custom message" />);
    expect(screen.getByText("Custom Title")).toBeInTheDocument();
    expect(screen.getByText("Custom message")).toBeInTheDocument();
  });

  it("renders inline variant", () => {
    render(<ErrorState variant="inline" message="Inline error" />);
    expect(screen.getByText("Inline error")).toBeInTheDocument();
  });

  it("calls onRetry when retry button clicked", async () => {
    const onRetry = jest.fn();
    render(<ErrorState onRetry={onRetry} />);
    
    await userEvent.click(screen.getByText("Try again"));
    
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});