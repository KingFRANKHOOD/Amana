import React from "react";
import { render } from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";
import { Button } from "@/components/ui/Button";
import { FormField } from "@/components/ui/FormField";
import { Tabs } from "@/components/ui/Tabs";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { TradeListItem } from "@/components/trade/TradeListItem";

expect.extend(toHaveNoViolations);

describe("Accessibility audit — WCAG 2.1 AA", () => {
  describe("Button", () => {
    it("primary variant has no axe violations", async () => {
      const { container } = render(<Button variant="primary">Submit</Button>);
      expect(await axe(container)).toHaveNoViolations();
    });

    it("secondary variant has no axe violations", async () => {
      const { container } = render(<Button variant="secondary">Cancel</Button>);
      expect(await axe(container)).toHaveNoViolations();
    });

    it("disabled state has no axe violations", async () => {
      const { container } = render(<Button disabled>Disabled</Button>);
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  describe("FormField", () => {
    it("has no axe violations with a valid input", async () => {
      const { container } = render(
        <FormField label="Email" name="email" required>
          <input type="email" />
        </FormField>
      );
      expect(await axe(container)).toHaveNoViolations();
    });

    it("has no axe violations in error state", async () => {
      const { container } = render(
        <FormField label="Email" name="email" error="Invalid email address">
          <input type="email" aria-invalid />
        </FormField>
      );
      expect(await axe(container)).toHaveNoViolations();
    });

    it("has no axe violations with hint text", async () => {
      const { container } = render(
        <FormField label="Username" name="username" hint="Letters only">
          <input type="text" />
        </FormField>
      );
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  describe("Tabs", () => {
    const items = [
      { value: "active", label: "Active" },
      { value: "settled", label: "Settled" },
      { value: "disputed", label: "Disputed" },
    ];

    it("underline variant has no axe violations", async () => {
      const { container } = render(
        <Tabs items={items} activeValue="active" onChange={() => {}} variant="underline" />
      );
      expect(await axe(container)).toHaveNoViolations();
    });

    it("bordered variant has no axe violations", async () => {
      const { container } = render(
        <Tabs items={items} activeValue="settled" onChange={() => {}} variant="bordered" />
      );
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  describe("Badge", () => {
    it("has no axe violations", async () => {
      const { container } = render(<Badge>New</Badge>);
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  describe("StatusBadge", () => {
    it("has no axe violations", async () => {
      const { container } = render(<StatusBadge status="pending" />);
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  describe("TradeListItem", () => {
    const baseProps = {
      tradeId: "trade-001",
      commodity: "Crude Oil",
      counterparty: { role: "Buyer", address: "0x1234567890abcdef" },
      amountCngn: "500,000",
      status: "PENDING" as const,
      createdAt: "2026-06-01T10:00:00Z",
      onView: () => {},
    };

    it("has no axe violations in PENDING state", async () => {
      const { container } = render(<TradeListItem {...baseProps} />);
      expect(await axe(container)).toHaveNoViolations();
    });

    it("has no axe violations in SETTLED state", async () => {
      const { container } = render(
        <TradeListItem {...baseProps} status="SETTLED" />
      );
      expect(await axe(container)).toHaveNoViolations();
    });

    it("has no axe violations in DISPUTED state", async () => {
      const { container } = render(
        <TradeListItem {...baseProps} status="DISPUTED" />
      );
      expect(await axe(container)).toHaveNoViolations();
    });

    it("has no axe violations with deposit/withdraw actions", async () => {
      const { container } = render(
        <TradeListItem
          {...baseProps}
          onDeposit={() => {}}
          onWithdraw={() => {}}
        />
      );
      expect(await axe(container)).toHaveNoViolations();
    });
  });
});
