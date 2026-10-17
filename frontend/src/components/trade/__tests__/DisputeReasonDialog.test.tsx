import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe, toHaveNoViolations } from "jest-axe";
import { DisputeReasonDialog } from "../DisputeReasonDialog";

expect.extend(toHaveNoViolations);

function renderDialog(
  overrides: Partial<React.ComponentProps<typeof DisputeReasonDialog>> = {},
) {
  const props: React.ComponentProps<typeof DisputeReasonDialog> = {
    open: true,
    onOpenChange: jest.fn(),
    onSubmit: jest.fn().mockResolvedValue(true),
    ...overrides,
  };
  render(<DisputeReasonDialog {...props} />);
  return props;
}

describe("DisputeReasonDialog", () => {
  it("has no detectable accessibility violations", async () => {
    renderDialog();
    const dialog = await screen.findByRole("dialog", {
      name: /initiate dispute/i,
    });

    expect(await axe(dialog)).toHaveNoViolations();
  });

  it("focuses the reason field and closes with Escape", async () => {
    const user = userEvent.setup();
    const onOpenChange = jest.fn();
    renderDialog({ onOpenChange });

    const reason = await screen.findByRole("textbox", {
      name: /dispute reason/i,
    });
    await waitFor(() => expect(reason).toHaveFocus());

    await user.keyboard("{Escape}");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("validates the reason before submission and updates the error live", async () => {
    const user = userEvent.setup();
    const onSubmit = jest.fn().mockResolvedValue(true);
    renderDialog({ onSubmit });

    const reason = await screen.findByRole("textbox", {
      name: /dispute reason/i,
    });
    await user.type(reason, "short");

    expect(
      screen.getByRole("alert", { name: "" }),
    ).toHaveTextContent("at least 10 characters");

    await user.click(screen.getByRole("button", { name: /submit dispute/i }));
    expect(onSubmit).not.toHaveBeenCalled();

    await user.type(reason, " enough");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows a loading state and submits the trimmed reason", async () => {
    const user = userEvent.setup();
    let resolveSubmission: ((value: boolean) => void) | undefined;
    const onSubmit = jest.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolveSubmission = resolve;
        }),
    );
    const onOpenChange = jest.fn();
    renderDialog({ onSubmit, onOpenChange });

    const reason = await screen.findByRole("textbox", {
      name: /dispute reason/i,
    });
    await user.type(reason, "  Item never arrived  ");
    await user.click(screen.getByRole("button", { name: /submit dispute/i }));

    expect(onSubmit).toHaveBeenCalledWith("Item never arrived");
    expect(screen.getByRole("button", { name: /submitting/i })).toBeDisabled();

    resolveSubmission?.(true);
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });
});
