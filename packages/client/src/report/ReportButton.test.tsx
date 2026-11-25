/**
 * The corner "Report a bug" button away from a table, and how a table offers its
 * details to it. At a live table it is tested in `ReportSheet.test.tsx`.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { TableReport } from "./context";
import { ReportButton } from "./ReportButton";
import { PAGE_DISCLOSURE } from "./ReportSheet";
import { currentTableReport, useTableReportSource } from "./reportSource";

/** Stands in for a table on screen, offering its details while mounted. */
function FakeTable({ read }: { readonly read: () => TableReport }): null {
  useTableReportSource(read);
  return null;
}

const table = { roundOver: false } as unknown as TableReport;

afterEach(cleanup);

describe("the corner Report a bug button", () => {
  it("opens the report away from a table, without a table's details", () => {
    render(<ReportButton />);
    fireEvent.click(screen.getByRole("button", { name: "Report a bug" }));
    const sheet = screen.getByRole("dialog", { name: "Report a bug" });
    expect(within(sheet).getByText(PAGE_DISCLOSURE)).toBeInTheDocument();
  });

  it("forgets the table once it is gone, and keeps the newest one on screen", () => {
    const first = render(<FakeTable read={() => table} />);
    expect(currentTableReport()).toBe(table);
    const second = { roundOver: true } as unknown as TableReport;
    const other = render(<FakeTable read={() => second} />);
    expect(currentTableReport()).toBe(second);
    // The older one leaving does not take the newer one's place away.
    first.unmount();
    expect(currentTableReport()).toBe(second);
    other.unmount();
    expect(currentTableReport()).toBeNull();
  });
});
