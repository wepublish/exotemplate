export const useFinanceCalculations = () => {
  /**
   * If you have worked hours and want to bill them. It adds the wep percentage on top.
   * @param hours
   * @param wepPercentage
   * @returns
   */
  function getHoursWithWepPercentageOnTop(
    hours: number | undefined,
    wepPercentage: number | undefined
  ): number {
    return (
      Math.round(((hours || 0) * 100) / (100 - (wepPercentage || 0)) / 0.25) *
      0.25
    )
  }

  /**
   * If you have an money amount and want to get the different hours out of it.
   * Function is copy & paste from api.
   * @param amount
   * @param hourlyRate
   * @param wepPercentage
   * @returns
   */
  function getHoursByAmount(
    amount: number | undefined,
    hourlyRate: number | undefined,
    wepPercentage: number | undefined
  ): {
    paidHours: number
    clientHours: number
    wepHours: number
  } {
    const paidHours = Math.round(((amount || 0) / (hourlyRate || 0)) * 2) / 2

    const clientHours =
      Math.round((paidHours * (100 - (wepPercentage || 0))) / 100 / 0.25) * 0.25
    const wepHours = paidHours - clientHours

    return {
      paidHours,
      clientHours,
      wepHours
    }
  }

  /**
   * Hosting / recurring invoice totals. Deliberately kept apart from the
   * hour-based functions above: hosting is amount-only and must never touch the
   * hours calculation. `gross = net + VAT`, VAT at the Swiss 8.1% rate (same
   * 0.081 used elsewhere). `billedUnits` is the number of units (e.g. months)
   * actually invoiced now (e.g. 7 of 12).
   */
  function getHostingInvoiceTotals(
    unitPrice: number | undefined,
    billedUnits: number | undefined
  ): { net: number; vat: number; gross: number } {
    const net = (unitPrice || 0) * (billedUnits || 0)
    const vat = Math.round(net * 0.081 * 100) / 100
    const gross = net + vat
    return { net, vat, gross }
  }

  /**
   * Full annual net total of the recurring order (e.g. 12 × 390), shown in the
   * hosting preview so the admin sees the yearly arrangement behind the first
   * (partial) invoice.
   */
  function getHostingOrderAnnualTotal(
    unitPrice: number | undefined,
    quantity: number | undefined
  ): number {
    return (unitPrice || 0) * (quantity || 0)
  }

  return {
    getHoursWithWepPercentageOnTop,
    getHoursByAmount,
    getHostingInvoiceTotals,
    getHostingOrderAnnualTotal
  }
}
