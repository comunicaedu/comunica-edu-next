import { PlayerHistoryProvider } from "@/contexts/PlayerHistoryContext";

export default function PlayerLayout({ children }: { children: React.ReactNode }) {
  return <PlayerHistoryProvider>{children}</PlayerHistoryProvider>;
}
