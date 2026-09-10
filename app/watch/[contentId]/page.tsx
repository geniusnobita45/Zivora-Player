import { notFound } from "next/navigation";
import { z } from "zod";
import { WatchClient } from "@/components/player/WatchClient";
export const metadata = { title: "Watch | Zivora" };
export default async function WatchPage({
  params,
  searchParams,
}: {
  params: Promise<{ contentId: string }>;
  searchParams: Promise<{ episode?: string | string[] }>;
}) {
  const [route, query] = await Promise.all([params, searchParams]);
  const input = z
    .object({ contentId: z.string().uuid(), episodeId: z.string().uuid().optional() })
    .safeParse({ contentId: route.contentId, episodeId: query.episode });
  if (!input.success) notFound();
  return <WatchClient key={input.data.contentId} {...input.data} />;
}
