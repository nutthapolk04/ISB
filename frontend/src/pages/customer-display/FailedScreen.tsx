/**
 * Payment Failed — dwells for 5 seconds then auto-returns to Standby.
 * Auto-back timer is owned by the parent CustomerDisplay component.
 */
import { XCircle } from "lucide-react";

interface Props {
  reason: string;
}

export function FailedScreen({ reason }: Props) {
  return (
    <div className="h-screen w-screen bg-gradient-to-br from-red-50 via-white to-red-50 flex flex-col items-center justify-center px-12">
      <XCircle className="h-32 w-32 text-red-500 mb-6" strokeWidth={2} />
      <h1 className="text-6xl font-extrabold text-zinc-900">Payment Failed</h1>
      <p className="mt-6 text-2xl text-red-700 font-medium max-w-2xl text-center">
        {reason}
      </p>
      <p className="mt-6 text-base text-zinc-500">
        Please ask the cashier to try again.
      </p>
    </div>
  );
}
