export function localDateTime(value: string) {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}
export function assignmentTimes(form: FormData) {
  const arrives = new Date(String(form.get("arrives_at"))),
    finishes = new Date(String(form.get("finishes_at")));
  if (
    !Number.isFinite(arrives.getTime()) ||
    !Number.isFinite(finishes.getTime()) ||
    finishes <= arrives
  )
    throw new Error(
      "Predvideni zaključek mora biti po prihodu. Preverite tudi datum.",
    );
  return {
    arrives_at: arrives.toISOString(),
    finishes_at: finishes.toISOString(),
  };
}
