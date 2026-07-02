export function useHours() {
  function secondsToHours(seconds: number): string {
    return (seconds / 3600).toFixed(2)
  }

  return {
    secondsToHours
  }
}
