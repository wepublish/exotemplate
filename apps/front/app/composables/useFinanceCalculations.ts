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

  return {
    getHoursWithWepPercentageOnTop,
    getHoursByAmount
  }
}
