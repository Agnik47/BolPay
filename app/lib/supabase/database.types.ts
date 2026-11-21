/**
 * Database types for supabase-js. Row shapes mirror
 * supabase/migrations/*.sql (regenerate with the Supabase MCP
 * `generate_typescript_types` or `supabase gen types` after schema changes).
 */
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

type Table<Row, Required extends keyof Row = never> = {
  Row: Row;
  Insert: Partial<Row> & Pick<Row, Required>;
  Update: Partial<Row>;
  Relationships: [];
};

export type BusinessRow = {
  id: string;
  name: string;
  currency: string;
  period_anchor: string;
  period_length_days: number;
  business_type: string;
  city: string;
  team_size: string;
  /** { step?, completed_at? }: empty until the owner goes through the onboarding wizard. */
  onboarding: Json;
  created_at: string;
};

export type MemberRow = {
  business_id: string;
  user_id: string;
  role: "owner" | "supervisor" | "worker";
  worker_ref: string | null;
  display_name: string;
  created_at: string;
};

export type InviteRow = {
  id: string;
  business_id: string;
  role: "supervisor" | "worker";
  worker_ref: string | null;
  invitee_name: string;
  token_hash: string;
  created_by: string | null;
  created_at: string;
  expires_at: string;
  used_at: string | null;
  used_by: string | null;
  revoked_at: string | null;
};

export type WorkerRow = {
  id: string;
  business_id: string;
  user_id: string | null;
  name: string;
  job_role: string;
  phone: string;
  payout_email: string;
  daily_wage: number;
  joined_on: string;
  status: "active" | "inactive";
  created_at: string;
};

export type AttendanceRow = {
  id: number;
  business_id: string;
  worker_id: string;
  date: string;
  status: "present" | "half" | "absent" | "leave";
  overtime_hours: number;
  units: number;
  updated_by: string | null;
  updated_at: string;
};

export type IncentiveRulesRow = {
  business_id: string;
  working_hours_per_day: number;
  overtime_multiplier: number;
  daily_unit_target: number;
  rate_per_extra_unit: number;
  attendance_threshold: number;
  attendance_bonus: number;
  updated_at: string;
};

export type PayoutRow = {
  id: string;
  business_id: string;
  worker_id: string;
  period_id: string;
  period_label: string;
  period_start: string;
  period_end: string;
  breakdown: Json;
  amount: number;
  status: "pending" | "approved" | "rejected";
  submitted_by: string | null;
  submitted_at: string;
  decided_by: string | null;
  decided_at: string | null;
};

export type TransactionRow = {
  id: string;
  business_id: string;
  payout_id: string;
  worker_id: string;
  period_label: string;
  amount: number;
  status: "processing" | "completed" | "failed";
  reference: string;
  failure_reason: string | null;
  paypal_batch_id: string | null;
  paypal_item_id: string | null;
  created_at: string;
  updated_at: string;
};

export type VoiceLogRow = {
  id: number;
  business_id: string;
  user_id: string | null;
  transcript: string;
  intent: Json | null;
  result: string | null;
  created_at: string;
};

export type Database = {
  public: {
    Tables: {
      businesses: Table<BusinessRow, "name">;
      members: Table<MemberRow, "business_id" | "user_id" | "role">;
      workers: Table<WorkerRow, "business_id" | "name" | "daily_wage">;
      attendance: Table<AttendanceRow, "business_id" | "worker_id" | "date" | "status">;
      incentive_rules: Table<IncentiveRulesRow, "business_id">;
      payouts: Table<
        PayoutRow,
        "business_id" | "worker_id" | "period_id" | "period_label" | "period_start" | "period_end" | "breakdown" | "amount"
      >;
      transactions: Table<TransactionRow, "business_id" | "payout_id" | "worker_id" | "period_label" | "amount">;
      voice_logs: Table<VoiceLogRow, "business_id" | "transcript">;
      invites: Table<InviteRow, "business_id" | "role" | "token_hash">;
    };
    Views: { [_ in never]: never };
    Functions: {
      create_business: {
        Args: { p_name: string; p_type?: string; p_city?: string; p_team_size?: string; p_period_days?: number };
        Returns: string;
      };
      create_invite: { Args: { p_role: "supervisor" | "worker"; p_worker_ref?: string | null; p_name?: string }; Returns: string };
      preview_invite: {
        Args: { p_token: string };
        Returns: { business_name: string; role: "supervisor" | "worker"; invitee_name: string; inviter_name: string }[];
      };
      accept_invite: {
        Args: { p_token: string };
        Returns: { business_id: string; role: "supervisor" | "worker"; worker_ref: string | null }[];
      };
      revoke_invite: { Args: { p_invite_id: string }; Returns: undefined };
    };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};
