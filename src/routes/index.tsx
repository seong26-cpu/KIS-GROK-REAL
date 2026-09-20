import { createFileRoute } from "@tanstack/react-router";
import { ScannerDesk } from "@/components/scanner/desk";
import { fetchSihwangFn } from "@/lib/scanner/fns";
import type { SihwangSnapshot } from "@/lib/scanner/types";

type LoaderData = {
  sihwang: SihwangSnapshot | null;
  sihwangError: string | null;
};

export const Route = createFileRoute("/")({
  loader: async (): Promise<LoaderData> => {
    try {
      const res = await fetchSihwangFn({ data: {} });
      if (res.ok) return { sihwang: res.sihwang, sihwangError: null };
      return { sihwang: null, sihwangError: res.error };
    } catch (e) {
      return { sihwang: null, sihwangError: e instanceof Error ? e.message : String(e) };
    }
  },
  component: Home,
});

function Home() {
  const data = Route.useLoaderData() as LoaderData | undefined;
  return <ScannerDesk initialSihwang={data?.sihwang ?? null} initialSihwangError={data?.sihwangError ?? null} />;
}
