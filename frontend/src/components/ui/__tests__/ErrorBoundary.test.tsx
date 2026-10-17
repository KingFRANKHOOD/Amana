import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { ErrorBoundary } from "../ErrorBoundary";

function ThrowingChild({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) {
    throw new Error("Test error");
  }
  return <div>Recovered content</div>;
}

function RecoverableChild() {
  const [shouldThrow, setShouldThrow] = useState(true);

  return (
    <ErrorBoundary onReset={() => setShouldThrow(false)}>
      <ThrowingChild shouldThrow={shouldThrow} />
    </ErrorBoundary>
  );
}

describe("ErrorBoundary", () => {
  it("renders children when no error", () => {
    render(
      <ErrorBoundary>
        <div>Child content</div>
      </ErrorBoundary>
    );
    expect(screen.getByText("Child content")).toBeInTheDocument();
  });

  it("renders a user-friendly fallback when a child throws", () => {
    const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});

    render(
      <ErrorBoundary>
        <ThrowingChild shouldThrow />
      </ErrorBoundary>,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "We could not load this page",
    );
    expect(screen.getByText("The service may be temporarily unavailable.")).toBeInTheDocument();
    expect(screen.queryByText("Test error")).not.toBeInTheDocument();

    consoleError.mockRestore();
  });

  it("retries rendering the child", () => {
    const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});

    render(<RecoverableChild />);

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(screen.getByText("Recovered content")).toBeInTheDocument();
    consoleError.mockRestore();
  });
});