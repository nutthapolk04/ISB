import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Login from "./Login";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockNavigate = vi.fn();
vi.mock("react-router-dom", () => ({
  useNavigate: () => mockNavigate,
}));

const mockToastError = vi.fn();
vi.mock("sonner", () => ({
  toast: { error: (...args: unknown[]) => mockToastError(...args) },
}));

const mockLogin = vi.fn();
const mockLoginWithMockSSO = vi.fn();
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    login: mockLogin,
    loginWithMockSSO: mockLoginWithMockSSO,
    isAuthenticated: false,
  }),
}));

// InputOTP renders hidden inputs internally — swap for a plain <input> in tests
vi.mock("@/components/ui/input-otp", () => ({
  InputOTP: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <input
      data-testid="otp-input"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      maxLength={6}
    />
  ),
  InputOTPGroup: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  InputOTPSlot: () => null,
}));

vi.mock("input-otp", () => ({
  REGEXP_ONLY_DIGITS: "^\\d+$",
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

function renderLogin() {
  return render(<Login />);
}

async function advanceToOtpStep(email = "test@isb.ac.th") {
  await userEvent.click(screen.getByRole("button", { name: /sign in with google/i }));
  await userEvent.type(screen.getByPlaceholderText(/your@isb.ac.th/i), email);
  await userEvent.click(screen.getByRole("button", { name: /next/i }));
}

async function advanceToPdpaStep(email = "test@isb.ac.th") {
  await advanceToOtpStep(email);
  const otpInput = screen.getByTestId("otp-input");
  fireEvent.change(otpInput, { target: { value: "247831" } });
  await userEvent.click(screen.getByRole("button", { name: /verify/i }));
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("Login — Google SSO multi-step flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLogin.mockResolvedValue({ success: false, error: "Invalid credentials" });
    mockLoginWithMockSSO.mockResolvedValue({ success: true });
  });

  // ── Initial state ──────────────────────────────────────────────────────────

  it("shows Sign In form and Google SSO button on initial render", () => {
    renderLogin();
    expect(screen.getByRole("button", { name: /sign in$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sign in with google/i })).toBeInTheDocument();
  });

  it("does not show email / OTP / PDPA steps on initial render", () => {
    renderLogin();
    expect(screen.queryByPlaceholderText(/your@isb.ac.th/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId("otp-input")).not.toBeInTheDocument();
    expect(screen.queryByText(/Privacy Policy/i)).not.toBeInTheDocument();
  });

  // ── Step 1: Email ──────────────────────────────────────────────────────────

  it("clicking Google SSO button shows email step", async () => {
    renderLogin();
    await userEvent.click(screen.getByRole("button", { name: /sign in with google/i }));
    expect(screen.getByPlaceholderText(/your@isb.ac.th/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /next/i })).toBeInTheDocument();
  });

  it("Next button is disabled when email is empty", async () => {
    renderLogin();
    await userEvent.click(screen.getByRole("button", { name: /sign in with google/i }));
    expect(screen.getByRole("button", { name: /next/i })).toBeDisabled();
  });

  it("Next button enables when email is filled", async () => {
    renderLogin();
    await userEvent.click(screen.getByRole("button", { name: /sign in with google/i }));
    await userEvent.type(screen.getByPlaceholderText(/your@isb.ac.th/i), "user@isb.ac.th");
    expect(screen.getByRole("button", { name: /next/i })).not.toBeDisabled();
  });

  it("back arrow on email step resets to initial state", async () => {
    renderLogin();
    await userEvent.click(screen.getByRole("button", { name: /sign in with google/i }));
    // ChevronLeft button — use its accessible role or a broader selector
    const backBtn = screen.getByRole("button", { name: "" });
    await userEvent.click(backBtn);
    expect(screen.queryByPlaceholderText(/your@isb.ac.th/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sign in with google/i })).toBeInTheDocument();
  });

  it("submitting email step moves to OTP step", async () => {
    renderLogin();
    await advanceToOtpStep();
    expect(screen.getByTestId("otp-input")).toBeInTheDocument();
    expect(screen.getByText(/2-Step Verification/i)).toBeInTheDocument();
  });

  it("OTP step displays the user's email", async () => {
    renderLogin();
    await advanceToOtpStep("myemail@isb.ac.th");
    expect(screen.getByText(/myemail@isb.ac.th/)).toBeInTheDocument();
  });

  // ── Step 2: OTP ────────────────────────────────────────────────────────────

  it("Verify button is disabled when OTP is fewer than 6 digits", async () => {
    renderLogin();
    await advanceToOtpStep();
    fireEvent.change(screen.getByTestId("otp-input"), { target: { value: "123" } });
    expect(screen.getByRole("button", { name: /verify/i })).toBeDisabled();
  });

  it("wrong OTP shows error message", async () => {
    renderLogin();
    await advanceToOtpStep();
    fireEvent.change(screen.getByTestId("otp-input"), { target: { value: "000000" } });
    await userEvent.click(screen.getByRole("button", { name: /verify/i }));
    expect(screen.getByText(/Invalid OTP code/i)).toBeInTheDocument();
  });

  it("correct OTP (247831) moves to PDPA step", async () => {
    renderLogin();
    await advanceToPdpaStep();
    expect(screen.getByText(/Privacy Policy/i)).toBeInTheDocument();
  });

  it("back arrow on OTP step goes back to email step", async () => {
    renderLogin();
    await advanceToOtpStep();
    const backBtn = screen.getByRole("button", { name: "" });
    await userEvent.click(backBtn);
    expect(screen.getByPlaceholderText(/your@isb.ac.th/i)).toBeInTheDocument();
    expect(screen.queryByTestId("otp-input")).not.toBeInTheDocument();
  });

  it("fixing OTP after error clears the error", async () => {
    renderLogin();
    await advanceToOtpStep();
    const otpInput = screen.getByTestId("otp-input");
    // wrong OTP first
    fireEvent.change(otpInput, { target: { value: "000000" } });
    await userEvent.click(screen.getByRole("button", { name: /verify/i }));
    expect(screen.getByText(/Invalid OTP code/i)).toBeInTheDocument();
    // start typing → error should clear
    fireEvent.change(otpInput, { target: { value: "2" } });
    expect(screen.queryByText(/Invalid OTP code/i)).not.toBeInTheDocument();
  });

  // ── Step 3: PDPA ───────────────────────────────────────────────────────────

  it("PDPA step shows Thai consent text", async () => {
    renderLogin();
    await advanceToPdpaStep();
    expect(screen.getByText(/Collection and Use of Personal Data/i)).toBeInTheDocument();
  });

  it("ปฏิเสธ resets flow back to initial state", async () => {
    renderLogin();
    await advanceToPdpaStep();
    await userEvent.click(screen.getByRole("button", { name: /Decline/i }));
    expect(screen.queryByText(/Privacy Policy/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sign in with google/i })).toBeInTheDocument();
  });

  it("ยอมรับ calls loginWithMockSSO with the entered email", async () => {
    renderLogin();
    await advanceToPdpaStep("demo@isb.ac.th");
    await userEvent.click(screen.getByRole("button", { name: /Accept/i }));
    await waitFor(() => expect(mockLoginWithMockSSO).toHaveBeenCalledWith("demo@isb.ac.th"));
  });

  it("successful SSO navigates to /", async () => {
    mockLoginWithMockSSO.mockResolvedValue({ success: true });
    renderLogin();
    await advanceToPdpaStep();
    await userEvent.click(screen.getByRole("button", { name: /Accept/i }));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith("/", { replace: true }));
  });

  it("failed SSO shows toast error and resets flow", async () => {
    mockLoginWithMockSSO.mockResolvedValue({ success: false, error: "SSO server error" });
    renderLogin();
    await advanceToPdpaStep();
    await userEvent.click(screen.getByRole("button", { name: /Accept/i }));
    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith(
      "SSO server error",
      expect.objectContaining({ duration: 6000 })
    ));
    expect(screen.queryByText(/Privacy Policy/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sign in with google/i })).toBeInTheDocument();
  });

  // ── OTP input reset between steps ─────────────────────────────────────────

  it("OTP value is cleared when navigating back to email then re-entering OTP step", async () => {
    renderLogin();
    await advanceToOtpStep();
    // fill partial OTP
    fireEvent.change(screen.getByTestId("otp-input"), { target: { value: "123456" } });
    // go back to email
    await userEvent.click(screen.getByRole("button", { name: "" }));
    // re-submit email
    await userEvent.click(screen.getByRole("button", { name: /next/i }));
    expect(screen.getByTestId("otp-input")).toHaveValue("");
  });
});
