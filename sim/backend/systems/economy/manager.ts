import type { EconomyState } from "../../../shared/types/index.js";

/**
 * Monthly wage settlement. Essential living costs are charged daily
 * (`daily_vitals`); this hook pays income then debt/savings.
 */
export class EconomyManager {
  monthlySettle(e: EconomyState, day: number): EconomyState {
    // Full wage — daily living costs already deducted via daily_vitals.
    let cash = e.cash + e.income;
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
