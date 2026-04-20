import EmbedPlayerClient from "@/components/player/EmbedPlayerClient";

interface Props {
  searchParams: Promise<{ client?: string; mode?: string }>;
}

export default async function EmbedPage({ searchParams }: Props) {
  const params = await searchParams;
  const ownerId = params.client ?? "";
  const mode = params.mode === "independent" ? "independent" : "mirror";

  if (!ownerId) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background text-muted-foreground text-sm">
        Link inválido.
      </div>
    );
  }

  return <EmbedPlayerClient ownerId={ownerId} mode={mode} />;
}
