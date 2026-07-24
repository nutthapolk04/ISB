export interface FamilyMember {
  entity_type: "user" | "customer";
  id: number;
  name: string;
  role: string | null;
  external_id: string | null;
  grade: string | null;
  photo_url: string | null;
  student_code: string | null;
  customer_code: string | null;
  customer_type: string | null;
  school_type: string | null;
  card_uid: string | null;
  parent_rank: string | null;
}

export interface IdentityHistoryItem {
  id: number;
  entity_type: string;
  old_external_id: string | null;
  new_external_id: string | null;
  reason: string | null;
  changed_by_name: string | null;
  changed_at: string;
}

export interface FamilyProfileData {
  family_code: string;
  notification_emails: string[];
  admin_notification_emails: string[];
  login_ids: string[];
  last_synced_at: string | null;
}

export interface UserDetailData {
  id: number;
  username: string;
  email: string;
  full_name: string;
  role: string | null;
  external_id: string | null;
  family_code: string | null;
  photo_url: string | null;
  status: string;
  is_active: boolean;
  last_synced_at: string | null;
  allergies: string | null;
  customer_type: string | null;
  card_uid: string | null;
  has_children: boolean;
  family_profile: FamilyProfileData | null;
  family_members: FamilyMember[];
  identity_history: IdentityHistoryItem[];
  shop_id: string | null;
  shop_name: string | null;
  staff_type?: string | null;
  ps_department?: string | null;
  wallet_balance: number | null;
}

export interface StudentOption {
  id: number;
  name: string;
  student_code: string | null;
  grade: string | null;
  family_code: string | null;
  external_id: string | null;
  school_type: string | null;
  card_uid: string | null;
}
