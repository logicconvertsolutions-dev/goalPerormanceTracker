export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      agent_closure: {
        Row: {
          ancestor_id: string
          depth: number
          descendant_id: string
        }
        Insert: {
          ancestor_id: string
          depth: number
          descendant_id: string
        }
        Update: {
          ancestor_id?: string
          depth?: number
          descendant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_closure_ancestor_id_fkey"
            columns: ["ancestor_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_closure_descendant_id_fkey"
            columns: ["descendant_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_email_changes: {
        Row: {
          agent_id: string
          confirmed_at: string | null
          created_at: string
          expires_at: string
          id: string
          new_email: string
          requested_by: string
          token_hash: string
        }
        Insert: {
          agent_id: string
          confirmed_at?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          new_email: string
          requested_by: string
          token_hash: string
        }
        Update: {
          agent_id?: string
          confirmed_at?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          new_email?: string
          requested_by?: string
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_email_changes_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_email_changes_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_nudges: {
        Row: {
          agent_id: string
          last_sent_at: string
          last_sent_by: string
        }
        Insert: {
          agent_id: string
          last_sent_at: string
          last_sent_by: string
        }
        Update: {
          agent_id?: string
          last_sent_at?: string
          last_sent_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_nudges_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: true
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_nudges_last_sent_by_fkey"
            columns: ["last_sent_by"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_training_reminders: {
        Row: {
          agent_id: string
          last_sent_at: string
          last_sent_by: string
        }
        Insert: {
          agent_id: string
          last_sent_at: string
          last_sent_by: string
        }
        Update: {
          agent_id?: string
          last_sent_at?: string
          last_sent_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_training_reminders_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: true
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_training_reminders_last_sent_by_fkey"
            columns: ["last_sent_by"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      agents: {
        Row: {
          created_at: string
          email: string
          full_name: string
          id: string
          joined_at: string
          org_id: string | null
          role: Database["public"]["Enums"]["agent_role"]
          status: Database["public"]["Enums"]["agent_status"]
          terms_accepted_at: string | null
          time_zone: string | null
          upline_id: string | null
        }
        Insert: {
          created_at?: string
          email: string
          full_name: string
          id: string
          joined_at?: string
          org_id?: string | null
          role?: Database["public"]["Enums"]["agent_role"]
          status?: Database["public"]["Enums"]["agent_status"]
          terms_accepted_at?: string | null
          time_zone?: string | null
          upline_id?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          joined_at?: string
          org_id?: string | null
          role?: Database["public"]["Enums"]["agent_role"]
          status?: Database["public"]["Enums"]["agent_status"]
          terms_accepted_at?: string | null
          time_zone?: string | null
          upline_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agents_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agents_upline_id_fkey"
            columns: ["upline_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      appointments: {
        Row: {
          agent_id: string
          appt_date: string
          appt_type: string | null
          client_request_id: string | null
          contact_id: string
          created_at: string
          expected_premium_cents: number
          follow_up_done_at: string | null
          follow_up_on: string | null
          id: string
          import_row_hash: string | null
          notes: string | null
          org_id: string
          referrals_given: number
          status: Database["public"]["Enums"]["appt_status"]
        }
        Insert: {
          agent_id: string
          appt_date: string
          appt_type?: string | null
          client_request_id?: string | null
          contact_id: string
          created_at?: string
          expected_premium_cents?: number
          follow_up_done_at?: string | null
          follow_up_on?: string | null
          id?: string
          import_row_hash?: string | null
          notes?: string | null
          org_id: string
          referrals_given?: number
          status?: Database["public"]["Enums"]["appt_status"]
        }
        Update: {
          agent_id?: string
          appt_date?: string
          appt_type?: string | null
          client_request_id?: string | null
          contact_id?: string
          created_at?: string
          expected_premium_cents?: number
          follow_up_done_at?: string | null
          follow_up_on?: string | null
          id?: string
          import_row_hash?: string | null
          notes?: string | null
          org_id?: string
          referrals_given?: number
          status?: Database["public"]["Enums"]["appt_status"]
        }
        Relationships: [
          {
            foreignKeyName: "appointments_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          entity: string
          entity_id: string | null
          id: number
          metadata: Json
          org_id: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          entity: string
          entity_id?: string | null
          id?: number
          metadata?: Json
          org_id?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          entity?: string
          entity_id?: string | null
          id?: number
          metadata?: Json
          org_id?: string | null
        }
        Relationships: []
      }
      call_logs: {
        Row: {
          agent_id: string
          call_date: string
          client_request_id: string | null
          contact_id: string
          created_at: string
          follow_up_done_at: string | null
          follow_up_on: string | null
          id: string
          import_row_hash: string | null
          notes: string | null
          org_id: string
          outcome: Database["public"]["Enums"]["call_outcome"]
          source: Database["public"]["Enums"]["call_source"]
        }
        Insert: {
          agent_id: string
          call_date?: string
          client_request_id?: string | null
          contact_id: string
          created_at?: string
          follow_up_done_at?: string | null
          follow_up_on?: string | null
          id?: string
          import_row_hash?: string | null
          notes?: string | null
          org_id: string
          outcome: Database["public"]["Enums"]["call_outcome"]
          source: Database["public"]["Enums"]["call_source"]
        }
        Update: {
          agent_id?: string
          call_date?: string
          client_request_id?: string | null
          contact_id?: string
          created_at?: string
          follow_up_done_at?: string | null
          follow_up_on?: string | null
          id?: string
          import_row_hash?: string | null
          notes?: string | null
          org_id?: string
          outcome?: Database["public"]["Enums"]["call_outcome"]
          source?: Database["public"]["Enums"]["call_source"]
        }
        Relationships: [
          {
            foreignKeyName: "call_logs_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_logs_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_logs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      contacts: {
        Row: {
          agent_id: string
          created_at: string
          full_name: string
          id: string
          org_id: string
          phone: string | null
          phone_normalized: string | null
        }
        Insert: {
          agent_id: string
          created_at?: string
          full_name: string
          id?: string
          org_id: string
          phone?: string | null
          phone_normalized?: string | null
        }
        Update: {
          agent_id?: string
          created_at?: string
          full_name?: string
          id?: string
          org_id?: string
          phone?: string | null
          phone_normalized?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contacts_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_metrics: {
        Row: {
          activity_date: string
          agent_id: string
          appt_cancelled: number
          appt_held: number
          appt_no_show: number
          appt_rescheduled: number
          appt_scheduled: number
          appts_set: number
          calls_made: number
          follow_ups_done: number
          follow_ups_due: number
          org_id: string
          out_appt_set: number
          out_connected: number
          out_no_answer: number
          out_not_interested: number
          out_voicemail: number
          premium_cents: number
          recruiting_convos: number
          referrals_given: number
          sales_count: number
          src_cold: number
          src_friend: number
          src_other: number
          src_referral: number
          src_social_media: number
          src_warm_market: number
          updated_at: string
        }
        Insert: {
          activity_date: string
          agent_id: string
          appt_cancelled?: number
          appt_held?: number
          appt_no_show?: number
          appt_rescheduled?: number
          appt_scheduled?: number
          appts_set?: number
          calls_made?: number
          follow_ups_done?: number
          follow_ups_due?: number
          org_id: string
          out_appt_set?: number
          out_connected?: number
          out_no_answer?: number
          out_not_interested?: number
          out_voicemail?: number
          premium_cents?: number
          recruiting_convos?: number
          referrals_given?: number
          sales_count?: number
          src_cold?: number
          src_friend?: number
          src_other?: number
          src_referral?: number
          src_social_media?: number
          src_warm_market?: number
          updated_at?: string
        }
        Update: {
          activity_date?: string
          agent_id?: string
          appt_cancelled?: number
          appt_held?: number
          appt_no_show?: number
          appt_rescheduled?: number
          appt_scheduled?: number
          appts_set?: number
          calls_made?: number
          follow_ups_done?: number
          follow_ups_due?: number
          org_id?: string
          out_appt_set?: number
          out_connected?: number
          out_no_answer?: number
          out_not_interested?: number
          out_voicemail?: number
          premium_cents?: number
          recruiting_convos?: number
          referrals_given?: number
          sales_count?: number
          src_cold?: number
          src_friend?: number
          src_other?: number
          src_referral?: number
          src_social_media?: number
          src_warm_market?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_metrics_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_metrics_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      feedback: {
        Row: {
          agent_id: string
          category: Database["public"]["Enums"]["feedback_category"]
          created_at: string
          id: string
          message: string
          org_id: string | null
          page_url: string | null
          status: Database["public"]["Enums"]["feedback_status"]
          subject: string
        }
        Insert: {
          agent_id: string
          category?: Database["public"]["Enums"]["feedback_category"]
          created_at?: string
          id?: string
          message: string
          org_id?: string | null
          page_url?: string | null
          status?: Database["public"]["Enums"]["feedback_status"]
          subject: string
        }
        Update: {
          agent_id?: string
          category?: Database["public"]["Enums"]["feedback_category"]
          created_at?: string
          id?: string
          message?: string
          org_id?: string | null
          page_url?: string | null
          status?: Database["public"]["Enums"]["feedback_status"]
          subject?: string
        }
        Relationships: [
          {
            foreignKeyName: "feedback_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feedback_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      invitations: {
        Row: {
          accepted_at: string | null
          created_at: string
          created_by: string | null
          email: string
          expires_at: string
          id: string
          org_id: string | null
          revoked_at: string | null
          role: Database["public"]["Enums"]["agent_role"]
          token_hash: string
          upline_id: string | null
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          created_by?: string | null
          email: string
          expires_at?: string
          id?: string
          org_id?: string | null
          revoked_at?: string | null
          role?: Database["public"]["Enums"]["agent_role"]
          token_hash: string
          upline_id?: string | null
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          created_by?: string | null
          email?: string
          expires_at?: string
          id?: string
          org_id?: string | null
          revoked_at?: string | null
          role?: Database["public"]["Enums"]["agent_role"]
          token_hash?: string
          upline_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invitations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitations_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitations_upline_id_fkey"
            columns: ["upline_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      mfa_recovery_codes: {
        Row: {
          agent_id: string
          code_hash: string
          created_at: string
          id: string
          used_at: string | null
        }
        Insert: {
          agent_id: string
          code_hash: string
          created_at?: string
          id?: string
          used_at?: string | null
        }
        Update: {
          agent_id?: string
          code_hash?: string
          created_at?: string
          id?: string
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mfa_recovery_codes_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_log: {
        Row: {
          agent_id: string
          id: string
          kind: string
          local_date: string
          sent_at: string
        }
        Insert: {
          agent_id: string
          id?: string
          kind: string
          local_date: string
          sent_at?: string
        }
        Update: {
          agent_id?: string
          id?: string
          kind?: string
          local_date?: string
          sent_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_log_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_prefs: {
        Row: {
          agent_id: string
          evening_nudge: boolean
          monday_digest: boolean
          sunday_summary: boolean
          updated_at: string
        }
        Insert: {
          agent_id: string
          evening_nudge?: boolean
          monday_digest?: boolean
          sunday_summary?: boolean
          updated_at?: string
        }
        Update: {
          agent_id?: string
          evening_nudge?: boolean
          monday_digest?: boolean
          sunday_summary?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_prefs_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: true
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          call_log_retention_months: number
          created_at: string
          id: string
          logo_path: string | null
          name: string
          owner_id: string | null
        }
        Insert: {
          call_log_retention_months?: number
          created_at?: string
          id?: string
          logo_path?: string | null
          name: string
          owner_id?: string | null
        }
        Update: {
          call_log_retention_months?: number
          created_at?: string
          id?: string
          logo_path?: string | null
          name?: string
          owner_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organizations_owner_fk"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      recruiting_logs: {
        Row: {
          agent_id: string
          client_request_id: string | null
          contact_id: string | null
          created_at: string
          id: string
          import_row_hash: string | null
          log_date: string
          notes: string | null
          org_id: string
          source: Database["public"]["Enums"]["call_source"] | null
          status: Database["public"]["Enums"]["recruit_status"]
        }
        Insert: {
          agent_id: string
          client_request_id?: string | null
          contact_id?: string | null
          created_at?: string
          id?: string
          import_row_hash?: string | null
          log_date?: string
          notes?: string | null
          org_id: string
          source?: Database["public"]["Enums"]["call_source"] | null
          status?: Database["public"]["Enums"]["recruit_status"]
        }
        Update: {
          agent_id?: string
          client_request_id?: string | null
          contact_id?: string | null
          created_at?: string
          id?: string
          import_row_hash?: string | null
          log_date?: string
          notes?: string | null
          org_id?: string
          source?: Database["public"]["Enums"]["call_source"] | null
          status?: Database["public"]["Enums"]["recruit_status"]
        }
        Relationships: [
          {
            foreignKeyName: "recruiting_logs_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recruiting_logs_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recruiting_logs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      sales: {
        Row: {
          agent_id: string
          appointment_id: string | null
          client_request_id: string | null
          contact_id: string | null
          created_at: string
          follow_up_done_at: string | null
          follow_up_on: string | null
          id: string
          import_row_hash: string | null
          notes: string | null
          org_id: string
          premium_cents: number
          product_type: string | null
          sale_date: string
        }
        Insert: {
          agent_id: string
          appointment_id?: string | null
          client_request_id?: string | null
          contact_id?: string | null
          created_at?: string
          follow_up_done_at?: string | null
          follow_up_on?: string | null
          id?: string
          import_row_hash?: string | null
          notes?: string | null
          org_id: string
          premium_cents?: number
          product_type?: string | null
          sale_date: string
        }
        Update: {
          agent_id?: string
          appointment_id?: string | null
          client_request_id?: string | null
          contact_id?: string | null
          created_at?: string
          follow_up_done_at?: string | null
          follow_up_on?: string | null
          id?: string
          import_row_hash?: string | null
          notes?: string | null
          org_id?: string
          premium_cents?: number
          product_type?: string | null
          sale_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "sales_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      targets: {
        Row: {
          agent_id: string | null
          appts_held_per_week: number
          calls_per_week: number
          created_at: string
          effective_from: string
          id: string
          md_deadline: string | null
          min_calls_per_day: number
          org_id: string
          premium_cents_per_week: number
          set_by: string | null
        }
        Insert: {
          agent_id?: string | null
          appts_held_per_week?: number
          calls_per_week?: number
          created_at?: string
          effective_from: string
          id?: string
          md_deadline?: string | null
          min_calls_per_day?: number
          org_id: string
          premium_cents_per_week?: number
          set_by?: string | null
        }
        Update: {
          agent_id?: string | null
          appts_held_per_week?: number
          calls_per_week?: number
          created_at?: string
          effective_from?: string
          id?: string
          md_deadline?: string | null
          min_calls_per_day?: number
          org_id?: string
          premium_cents_per_week?: number
          set_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "targets_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "targets_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "targets_set_by_fkey"
            columns: ["set_by"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      team_roster: {
        Row: {
          auto_reminders_enabled: boolean
          created_at: string
          created_by: string
          email: string | null
          full_name: string
          id: string
          invitation_id: string | null
          last_training_reminder_at: string | null
          notes: string | null
          org_id: string
          phone: string | null
          upline_id: string
        }
        Insert: {
          auto_reminders_enabled?: boolean
          created_at?: string
          created_by: string
          email?: string | null
          full_name: string
          id?: string
          invitation_id?: string | null
          last_training_reminder_at?: string | null
          notes?: string | null
          org_id: string
          phone?: string | null
          upline_id: string
        }
        Update: {
          auto_reminders_enabled?: boolean
          created_at?: string
          created_by?: string
          email?: string | null
          full_name?: string
          id?: string
          invitation_id?: string | null
          last_training_reminder_at?: string | null
          notes?: string | null
          org_id?: string
          phone?: string | null
          upline_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_roster_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_roster_invitation_id_fkey"
            columns: ["invitation_id"]
            isOneToOne: false
            referencedRelation: "invitations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_roster_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_roster_upline_id_fkey"
            columns: ["upline_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      team_roster_reminder_log: {
        Row: {
          id: string
          local_date: string
          roster_id: string
          sent_at: string
        }
        Insert: {
          id?: string
          local_date: string
          roster_id: string
          sent_at?: string
        }
        Update: {
          id?: string
          local_date?: string
          roster_id?: string
          sent_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_roster_reminder_log_roster_id_fkey"
            columns: ["roster_id"]
            isOneToOne: false
            referencedRelation: "team_roster"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_daily_active_loggers: {
        Args: { p_days?: number }
        Returns: {
          activity_date: string
          agent_id: string
          full_name: string
          logged: boolean
          org_id: string
          org_name: string
        }[]
      }
      admin_hard_delete_agent: {
        Args: { p_actor_id: string; p_agent_id: string }
        Returns: undefined
      }
      admin_move_agent: {
        Args: {
          p_actor_id: string
          p_agent_id: string
          p_new_upline_id: string
        }
        Returns: undefined
      }
      admin_reactivate_agent: {
        Args: { p_actor_id: string; p_agent_id: string }
        Returns: undefined
      }
      admin_set_agent_role: {
        Args: {
          p_actor_id: string
          p_agent_id: string
          p_role: Database["public"]["Enums"]["agent_role"]
          p_org_id?: string | null
        }
        Returns: undefined
      }
      agent_aggregate: {
        Args: { p_agent_id: string; p_from: string; p_to: string }
        Returns: {
          appt_cancelled: number
          appt_held: number
          appt_no_show: number
          appt_rescheduled: number
          appt_scheduled: number
          appts_held: number
          appts_set: number
          calls_made: number
          out_appt_set: number
          out_connected: number
          out_no_answer: number
          out_not_interested: number
          out_voicemail: number
          premium_cents: number
          recruiting_convos: number
          referrals_given: number
          sales_count: number
          src_cold: number
          src_friend: number
          src_other: number
          src_referral: number
          src_social_media: number
          src_warm_market: number
        }[]
      }
      agent_daily_activity: {
        Args: { p_agent_id: string; p_from: string; p_to: string }
        Returns: {
          activity_date: string
          appts_held: number
          appts_set: number
          calls_made: number
          min_calls_target: number
          min_met: boolean
          premium_cents: number
        }[]
      }
      agent_daily_breakdown: {
        Args: { p_agent_ids?: string[]; p_from: string; p_to: string }
        Returns: {
          activity_date: string
          appt_held: number
          appts_set: number
          calls_made: number
          recruiting_convos: number
          sales_count: number
        }[]
      }
      check_rate_limit: {
        Args: { p_limit: number; p_scope: string; p_window_seconds: number }
        Returns: boolean
      }
      create_invitation: {
        Args: {
          p_email: string
          p_role?: Database["public"]["Enums"]["agent_role"]
        }
        Returns: string
      }
      deactivate_agent: { Args: { p_agent_id: string }; Returns: undefined }
      delete_my_account: { Args: never; Returns: undefined }
      drain_metrics: { Args: { p_limit?: number }; Returns: number }
      my_followups: {
        Args: { p_as_of?: string }
        Returns: {
          call_id: string
          contact_id: string
          contact_name: string
          days_late: number
          follow_up_on: string
          last_note: string
          times_called: number
        }[]
      }
      my_target: {
        Args: { p_week: string }
        Returns: {
          appts_held_per_week: number
          calls_per_week: number
          md_deadline: string
          min_calls_per_day: number
          premium_cents_per_week: number
        }[]
      }
      nudge_agent: { Args: { p_agent_id: string }; Returns: undefined }
      provision_org: {
        Args: { p_org_name: string; p_smd_email: string; p_smd_name: string }
        Returns: {
          invite_token: string
          org_id: string
        }[]
      }
      send_roster_training_reminder: {
        Args: { p_roster_id: string }
        Returns: undefined
      }
      send_training_reminder: {
        Args: { p_agent_id: string }
        Returns: undefined
      }
      system_effective_target: {
        Args: { p_agent_id: string; p_week: string }
        Returns: {
          appts_held_per_week: number
          calls_per_week: number
          md_deadline: string
          min_calls_per_day: number
          premium_cents_per_week: number
        }[]
      }
      system_team_week_summary: {
        Args: { p_leader_id: string; p_week_start: string }
        Returns: {
          agent_id: string
          appts_held: number
          appts_held_target: number
          appts_set: number
          calls_made: number
          calls_target: number
          depth: number
          full_name: string
          has_override: boolean
          last_logged_at: string
          pct_calls: number
          premium_cents: number
          premium_cents_target: number
          streak_days: number
        }[]
      }
      team_breakdown: {
        Args: { p_agent_ids?: string[]; p_from: string; p_to: string }
        Returns: {
          appt_cancelled: number
          appt_held: number
          appt_no_show: number
          appt_rescheduled: number
          appt_scheduled: number
          appts_held: number
          appts_set: number
          calls_made: number
          out_appt_set: number
          out_connected: number
          out_no_answer: number
          out_not_interested: number
          out_voicemail: number
          premium_cents: number
          recruiting_convos: number
          referrals_given: number
          sales_count: number
          src_cold: number
          src_friend: number
          src_other: number
          src_referral: number
          src_social_media: number
          src_warm_market: number
        }[]
      }
      team_day_summary: {
        Args: { p_date: string }
        Returns: {
          agent_id: string
          appts_held: number
          appts_set: number
          calls_made: number
          full_name: string
          premium_cents: number
        }[]
      }
      team_inactive: {
        Args: { p_days?: number }
        Returns: {
          agent_id: string
          days_quiet: number
          full_name: string
          last_logged_at: string
        }[]
      }
      team_period_summary: {
        Args: { p_from: string; p_to: string }
        Returns: {
          agent_id: string
          appts_held: number
          appts_held_target: number
          appts_set: number
          calls_made: number
          calls_target: number
          depth: number
          full_name: string
          has_override: boolean
          last_logged_at: string
          pct_calls: number
          premium_cents: number
          premium_cents_target: number
          streak_days: number
        }[]
      }
      team_target: {
        Args: { p_agent_id: string; p_week: string }
        Returns: {
          appts_held_per_week: number
          calls_per_week: number
          md_deadline: string
          min_calls_per_day: number
          premium_cents_per_week: number
        }[]
      }
      team_trend: {
        Args: { p_agent_ids?: string[]; p_weeks?: number }
        Returns: {
          calls_made: number
          calls_target: number
          premium_cents: number
          week_start: string
        }[]
      }
      team_week_summary: {
        Args: { p_week_start: string }
        Returns: {
          agent_id: string
          appts_held: number
          appts_held_target: number
          appts_set: number
          calls_made: number
          calls_target: number
          depth: number
          full_name: string
          has_override: boolean
          last_logged_at: string
          pct_calls: number
          premium_cents: number
          premium_cents_target: number
          streak_days: number
        }[]
      }
      week_start: { Args: { d: string }; Returns: string }
    }
    Enums: {
      agent_role: "associate" | "leader" | "admin"
      agent_status: "active" | "inactive"
      appt_status:
        | "scheduled"
        | "held"
        | "no_show"
        | "rescheduled"
        | "cancelled"
      call_outcome:
        | "connected"
        | "voicemail"
        | "no_answer"
        | "appointment_set"
        | "not_interested"
      call_source:
        | "warm_market"
        | "referral"
        | "cold"
        | "social_media"
        | "friend"
        | "other"
      feedback_category: "bug" | "feature_request" | "feedback" | "other"
      feedback_status: "new" | "reviewed" | "resolved"
      recruit_status:
        | "contacted"
        | "marketing_presented"
        | "recruited"
        | "certified"
        | "licensed"
        | "declined"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      agent_role: ["associate", "leader", "admin"],
      agent_status: ["active", "inactive"],
      appt_status: ["scheduled", "held", "no_show", "rescheduled", "cancelled"],
      call_outcome: [
        "connected",
        "voicemail",
        "no_answer",
        "appointment_set",
        "not_interested",
      ],
      call_source: [
        "warm_market",
        "referral",
        "cold",
        "social_media",
        "friend",
        "other",
      ],
      feedback_category: ["bug", "feature_request", "feedback", "other"],
      feedback_status: ["new", "reviewed", "resolved"],
      recruit_status: [
        "contacted",
        "marketing_presented",
        "recruited",
        "certified",
        "licensed",
        "declined",
      ],
    },
  },
} as const
