import { notFound } from "next/navigation";
import { AdminNotFoundError, requireAdminScope } from "@/lib/admin";

export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  try {
    await requireAdminScope();
  } catch (error) {
    if (error instanceof AdminNotFoundError) {
      notFound();
    }
    throw error;
  }

  return children;
}
