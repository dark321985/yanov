import { useSearchParams } from "react-router-dom";

export function useFilters() {
  const [params, setParams] = useSearchParams();
  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== "page") next.set("page", "1");
    setParams(next, { replace: true, preventScrollReset: true });
  };
  const setMany = (values: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(values)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    next.set("page", "1");
    setParams(next, { replace: true, preventScrollReset: true });
  };
  const reset = () =>
    setParams(new URLSearchParams(), {
      replace: true,
      preventScrollReset: true,
    });
  const page = Math.max(1, Number(params.get("page")) || 1);
  return { params, set, setMany, reset, page };
}
