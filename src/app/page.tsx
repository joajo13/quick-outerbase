import { redirect } from "next/navigation";

// La home la servía (outerbase)/page.tsx (deprecada en la poda del CLI npx).
// En el flujo local el único destino es /env, así que redirigimos directo.
export default function RootPage() {
  redirect("/env");
}
