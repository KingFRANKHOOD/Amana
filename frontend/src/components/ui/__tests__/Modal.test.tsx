import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  ModalTrigger,
} from "../Modal";

function ControlledModal() {
  const [open, setOpen] = React.useState(false);

  return (
    <Modal open={open} onOpenChange={setOpen}>
      <ModalTrigger asChild>
        <button type="button">Open Modal</button>
      </ModalTrigger>
      <ModalContent>
        <ModalHeader>
          <ModalTitle>Test modal</ModalTitle>
          <ModalDescription>Focusable content test</ModalDescription>
        </ModalHeader>
        <ModalBody>
          <input aria-label="Name" />
        </ModalBody>
        <ModalFooter>
          <button type="button">Confirm</button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

describe("Modal", () => {
  it("opens and closes via trigger and close button", async () => {
    const user = userEvent.setup();
    render(<ControlledModal />);

    await user.click(screen.getByRole("button", { name: "Open Modal" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Close dialog" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes on Escape key", async () => {
    const user = userEvent.setup();
    render(<ControlledModal />);

    await user.click(screen.getByRole("button", { name: "Open Modal" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
