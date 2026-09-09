export function formatTrackCount(count: number): string {
  const lastDigit = count % 10
  const lastTwoDigits = count % 100
  if (lastDigit === 1 && lastTwoDigits !== 11) {
    return `${count} трек`
  }
  if (lastDigit >= 2 && lastDigit <= 4 && (lastTwoDigits < 12 || lastTwoDigits > 14)) {
    return `${count} трека`
  }
  return `${count} треков`
}
