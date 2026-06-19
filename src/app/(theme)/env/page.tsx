import ClientOnly from "@/components/client-only";
import EnvPageBody from "./page-client";

export default function EnvPage() {
  return (
    <ClientOnly>
      <EnvPageBody />
    </ClientOnly>
  );
}
