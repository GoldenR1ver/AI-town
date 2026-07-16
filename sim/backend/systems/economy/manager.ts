import type { EconomyState } from "../../../shared/types/index.js";

/**
 * Monthly settlement (plan.md §2.6):
 * cash += income * (1 - essentialExpenseRatio)
 * repay debt from cash
 * deposit += cash * savingsRatio; cash -= that
 */
export class EconomyManager {
  monthlySettle(e: EconomyState, day: number): EconomyState {
    let cash = e.cash + e.income * (1 - e.essentialExpenseRatio);
    const repayment = Math.min(e.debt, cash);
    const debt = e.debt - repayment;
    cash -= repayment;
    const savings = cash * e.savingsRatio;
    const deposit = e.deposit + savings;
    cash -= savings;
    return { ...e, cash, deposit, debt, lastSettlementDay: day };
  }

  /** Pure helper for unit checks. */
  static expectedAfterSettle(e: EconomyState): Pick<EconomyState, "cash" | "deposit" | "debt"> {
    const m = new EconomyManager();
    const next = m.monthlySettle(e, e.lastSettlementDay);
    return { cash: next.cash, deposit: next.deposit, debt: next.debt };
  }
}
