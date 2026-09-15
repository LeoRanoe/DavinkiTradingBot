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
      ai_usage_events: {
        Row: {
          created_at: string
          error_kind: string | null
          feature: string
          id: string
          input_tokens: number | null
          latency_ms: number | null
          model: string | null
          output_tokens: number | null
          provider: string
          success: boolean
          total_tokens: number | null
        }
        Insert: {
          created_at?: string
          error_kind?: string | null
          feature: string
          id?: string
          input_tokens?: number | null
          latency_ms?: number | null
          model?: string | null
          output_tokens?: number | null
          provider?: string
          success: boolean
          total_tokens?: number | null
        }
        Update: {
          created_at?: string
          error_kind?: string | null
          feature?: string
          id?: string
          input_tokens?: number | null
          latency_ms?: number | null
          model?: string | null
          output_tokens?: number | null
          provider?: string
          success?: boolean
          total_tokens?: number | null
        }
        Relationships: []
      }
      audit_events: {
        Row: {
          action: string
          actor: string
          created_at: string
          id: string
          metadata: Json | null
        }
        Insert: {
          action: string
          actor: string
          created_at?: string
          id?: string
          metadata?: Json | null
        }
        Update: {
          action?: string
          actor?: string
          created_at?: string
          id?: string
          metadata?: Json | null
        }
        Relationships: []
      }
      backtest_trades: {
        Row: {
          backtest_id: string
          entry_price: number
          entry_time: string
          exit_price: number | null
          exit_time: string | null
          fees: number
          id: string
          outcome: string | null
          pnl: number | null
          qty: number
          r_multiple: number | null
          regime: string | null
          score: number | null
          stop_price: number
          symbol: string
          target_price: number
        }
        Insert: {
          backtest_id: string
          entry_price: number
          entry_time: string
          exit_price?: number | null
          exit_time?: string | null
          fees?: number
          id?: string
          outcome?: string | null
          pnl?: number | null
          qty: number
          r_multiple?: number | null
          regime?: string | null
          score?: number | null
          stop_price: number
          symbol: string
          target_price: number
        }
        Update: {
          backtest_id?: string
          entry_price?: number
          entry_time?: string
          exit_price?: number | null
          exit_time?: string | null
          fees?: number
          id?: string
          outcome?: string | null
          pnl?: number | null
          qty?: number
          r_multiple?: number | null
          regime?: string | null
          score?: number | null
          stop_price?: number
          symbol?: string
          target_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "backtest_trades_backtest_id_fkey"
            columns: ["backtest_id"]
            isOneToOne: false
            referencedRelation: "backtests"
            referencedColumns: ["id"]
          },
        ]
      }
      backtests: {
        Row: {
          created_at: string
          date_from: string
          date_to: string
          fee_bps: number
          id: string
          metrics: Json
          slippage_bps: number
          split: Database["public"]["Enums"]["backtest_split"]
          strategy_version_id: string
          symbol: string
        }
        Insert: {
          created_at?: string
          date_from: string
          date_to: string
          fee_bps: number
          id?: string
          metrics: Json
          slippage_bps: number
          split: Database["public"]["Enums"]["backtest_split"]
          strategy_version_id: string
          symbol: string
        }
        Update: {
          created_at?: string
          date_from?: string
          date_to?: string
          fee_bps?: number
          id?: string
          metrics?: Json
          slippage_bps?: number
          split?: Database["public"]["Enums"]["backtest_split"]
          strategy_version_id?: string
          symbol?: string
        }
        Relationships: [
          {
            foreignKeyName: "backtests_strategy_version_id_fkey"
            columns: ["strategy_version_id"]
            isOneToOne: false
            referencedRelation: "strategy_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      candidate_news_links: {
        Row: {
          created_at: string
          id: string
          news_event_id: string
          position: number
          relevance_score: number
          signal_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          news_event_id: string
          position?: number
          relevance_score?: number
          signal_id: string
        }
        Update: {
          created_at?: string
          id?: string
          news_event_id?: string
          position?: number
          relevance_score?: number
          signal_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "candidate_news_links_news_event_id_fkey"
            columns: ["news_event_id"]
            isOneToOne: false
            referencedRelation: "news_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "candidate_news_links_signal_id_fkey"
            columns: ["signal_id"]
            isOneToOne: false
            referencedRelation: "signals"
            referencedColumns: ["id"]
          },
        ]
      }
      candles: {
        Row: {
          close: number
          created_at: string
          high: number
          id: number
          is_closed: boolean
          low: number
          open: number
          open_time: string
          symbol: string
          timeframe: string
          volume: number
        }
        Insert: {
          close: number
          created_at?: string
          high: number
          id?: never
          is_closed?: boolean
          low: number
          open: number
          open_time: string
          symbol: string
          timeframe: string
          volume: number
        }
        Update: {
          close?: number
          created_at?: string
          high?: number
          id?: never
          is_closed?: boolean
          low?: number
          open?: number
          open_time?: string
          symbol?: string
          timeframe?: string
          volume?: number
        }
        Relationships: []
      }
      counterfactual_outcomes: {
        Row: {
          conservative_ambiguous_candle: boolean
          created_at: string
          entry_price: number | null
          entry_time: string | null
          evaluated_at: string | null
          exit_price: number | null
          exit_time: string | null
          id: string
          is_hypothetical: boolean
          mae_price: number | null
          mae_r: number | null
          mfe_price: number | null
          mfe_r: number | null
          outcome: string
          plan_snapshot: Json
          r_multiple: number | null
          regime: string | null
          rejection_reason: string | null
          research_session_id: string | null
          score: number | null
          score_band: string | null
          signal_id: string
          source: string
          symbol: string | null
        }
        Insert: {
          conservative_ambiguous_candle?: boolean
          created_at?: string
          entry_price?: number | null
          entry_time?: string | null
          evaluated_at?: string | null
          exit_price?: number | null
          exit_time?: string | null
          id?: string
          is_hypothetical?: boolean
          mae_price?: number | null
          mae_r?: number | null
          mfe_price?: number | null
          mfe_r?: number | null
          outcome?: string
          plan_snapshot: Json
          r_multiple?: number | null
          regime?: string | null
          rejection_reason?: string | null
          research_session_id?: string | null
          score?: number | null
          score_band?: string | null
          signal_id: string
          source: string
          symbol?: string | null
        }
        Update: {
          conservative_ambiguous_candle?: boolean
          created_at?: string
          entry_price?: number | null
          entry_time?: string | null
          evaluated_at?: string | null
          exit_price?: number | null
          exit_time?: string | null
          id?: string
          is_hypothetical?: boolean
          mae_price?: number | null
          mae_r?: number | null
          mfe_price?: number | null
          mfe_r?: number | null
          outcome?: string
          plan_snapshot?: Json
          r_multiple?: number | null
          regime?: string | null
          rejection_reason?: string | null
          research_session_id?: string | null
          score?: number | null
          score_band?: string | null
          signal_id?: string
          source?: string
          symbol?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "counterfactual_outcomes_research_session_id_fkey"
            columns: ["research_session_id"]
            isOneToOne: false
            referencedRelation: "paper_research_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "counterfactual_outcomes_signal_id_fkey"
            columns: ["signal_id"]
            isOneToOne: true
            referencedRelation: "signals"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_performance: {
        Row: {
          created_at: string
          fees: number
          gross_pnl: number
          id: string
          losses: number
          net_pnl: number
          perf_date: string
          trades_count: number
          trading_mode: Database["public"]["Enums"]["trading_mode"]
          wins: number
        }
        Insert: {
          created_at?: string
          fees?: number
          gross_pnl?: number
          id?: string
          losses?: number
          net_pnl?: number
          perf_date: string
          trades_count?: number
          trading_mode: Database["public"]["Enums"]["trading_mode"]
          wins?: number
        }
        Update: {
          created_at?: string
          fees?: number
          gross_pnl?: number
          id?: string
          losses?: number
          net_pnl?: number
          perf_date?: string
          trades_count?: number
          trading_mode?: Database["public"]["Enums"]["trading_mode"]
          wins?: number
        }
        Relationships: []
      }
      instrument_metadata: {
        Row: {
          base_coin: string
          max_order_qty: number | null
          min_order_amt: number
          min_order_qty: number
          price_scale: number
          qty_step: number
          quote_coin: string
          raw: Json
          symbol: string
          tick_size: number
          updated_at: string
        }
        Insert: {
          base_coin: string
          max_order_qty?: number | null
          min_order_amt: number
          min_order_qty: number
          price_scale?: number
          qty_step: number
          quote_coin: string
          raw: Json
          symbol: string
          tick_size: number
          updated_at?: string
        }
        Update: {
          base_coin?: string
          max_order_qty?: number | null
          min_order_amt?: number
          min_order_qty?: number
          price_scale?: number
          qty_step?: number
          quote_coin?: string
          raw?: Json
          symbol?: string
          tick_size?: number
          updated_at?: string
        }
        Relationships: []
      }
      instrument_research_eligibility: {
        Row: {
          checked_at: string | null
          created_at: string
          instrument_id: string
          metrics: Json
          reasons: string[]
          status: string
          updated_at: string
        }
        Insert: {
          checked_at?: string | null
          created_at?: string
          instrument_id: string
          metrics?: Json
          reasons?: string[]
          status?: string
          updated_at?: string
        }
        Update: {
          checked_at?: string | null
          created_at?: string
          instrument_id?: string
          metrics?: Json
          reasons?: string[]
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "instrument_research_eligibility_instrument_id_fkey"
            columns: ["instrument_id"]
            isOneToOne: true
            referencedRelation: "instruments"
            referencedColumns: ["id"]
          },
        ]
      }
      instruments: {
        Row: {
          allows_long: boolean
          allows_short: boolean
          asset_class: string
          base_asset: string
          canonical_id: string
          contract_multiplier: number | null
          created_at: string
          id: string
          is_active: boolean
          lot_size: number | null
          max_size: number | null
          metadata: Json
          min_notional: number | null
          min_size: number | null
          pip_size: number | null
          price_increment: number | null
          quote_asset: string
          settlement_asset: string
          size_increment: number | null
          trading_calendar: string
          updated_at: string
          venue_id: string
          venue_symbol: string
        }
        Insert: {
          allows_long?: boolean
          allows_short?: boolean
          asset_class: string
          base_asset: string
          canonical_id: string
          contract_multiplier?: number | null
          created_at?: string
          id?: string
          is_active?: boolean
          lot_size?: number | null
          max_size?: number | null
          metadata?: Json
          min_notional?: number | null
          min_size?: number | null
          pip_size?: number | null
          price_increment?: number | null
          quote_asset: string
          settlement_asset: string
          size_increment?: number | null
          trading_calendar?: string
          updated_at?: string
          venue_id: string
          venue_symbol: string
        }
        Update: {
          allows_long?: boolean
          allows_short?: boolean
          asset_class?: string
          base_asset?: string
          canonical_id?: string
          contract_multiplier?: number | null
          created_at?: string
          id?: string
          is_active?: boolean
          lot_size?: number | null
          max_size?: number | null
          metadata?: Json
          min_notional?: number | null
          min_size?: number | null
          pip_size?: number | null
          price_increment?: number | null
          quote_asset?: string
          settlement_asset?: string
          size_increment?: number | null
          trading_calendar?: string
          updated_at?: string
          venue_id?: string
          venue_symbol?: string
        }
        Relationships: [
          {
            foreignKeyName: "instruments_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_credentials: {
        Row: {
          config: Json
          id: string
          integration: string
          last_checked_at: string | null
          status: string
          updated_at: string
          updated_by: string | null
          vault_secret_name: string | null
        }
        Insert: {
          config?: Json
          id?: string
          integration: string
          last_checked_at?: string | null
          status?: string
          updated_at?: string
          updated_by?: string | null
          vault_secret_name?: string | null
        }
        Update: {
          config?: Json
          id?: string
          integration?: string
          last_checked_at?: string | null
          status?: string
          updated_at?: string
          updated_by?: string | null
          vault_secret_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "integration_credentials_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      job_runs: {
        Row: {
          completed_at: string | null
          error_summary: string | null
          id: string
          job_name: string
          metadata: Json | null
          records_processed: number
          started_at: string
          status: Database["public"]["Enums"]["job_status"]
        }
        Insert: {
          completed_at?: string | null
          error_summary?: string | null
          id?: string
          job_name: string
          metadata?: Json | null
          records_processed?: number
          started_at?: string
          status?: Database["public"]["Enums"]["job_status"]
        }
        Update: {
          completed_at?: string | null
          error_summary?: string | null
          id?: string
          job_name?: string
          metadata?: Json | null
          records_processed?: number
          started_at?: string
          status?: Database["public"]["Enums"]["job_status"]
        }
        Relationships: []
      }
      knowledge_chunks: {
        Row: {
          chunk_index: number
          content: string
          created_at: string
          document_id: string
          embedding: string | null
          embedding_model: string | null
          embedding_version: string | null
          id: string
        }
        Insert: {
          chunk_index: number
          content: string
          created_at?: string
          document_id: string
          embedding?: string | null
          embedding_model?: string | null
          embedding_version?: string | null
          id?: string
        }
        Update: {
          chunk_index?: number
          content?: string
          created_at?: string
          document_id?: string
          embedding?: string | null
          embedding_model?: string | null
          embedding_version?: string | null
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_chunks_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "knowledge_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_documents: {
        Row: {
          content: string
          created_at: string
          id: string
          source_type: string
          strategy_version_id: string | null
          title: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          source_type: string
          strategy_version_id?: string | null
          title: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          source_type?: string
          strategy_version_id?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_documents_strategy_version_id_fkey"
            columns: ["strategy_version_id"]
            isOneToOne: false
            referencedRelation: "strategy_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      lessons: {
        Row: {
          body: string
          category: string
          created_at: string
          id: string
          related_signal_id: string | null
          related_trade_id: string | null
          status: Database["public"]["Enums"]["lesson_status"]
          title: string
        }
        Insert: {
          body: string
          category: string
          created_at?: string
          id?: string
          related_signal_id?: string | null
          related_trade_id?: string | null
          status?: Database["public"]["Enums"]["lesson_status"]
          title: string
        }
        Update: {
          body?: string
          category?: string
          created_at?: string
          id?: string
          related_signal_id?: string | null
          related_trade_id?: string | null
          status?: Database["public"]["Enums"]["lesson_status"]
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "lessons_related_signal_id_fkey"
            columns: ["related_signal_id"]
            isOneToOne: false
            referencedRelation: "signals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lessons_related_trade_id_fkey"
            columns: ["related_trade_id"]
            isOneToOne: false
            referencedRelation: "trades"
            referencedColumns: ["id"]
          },
        ]
      }
      news_event_sources: {
        Row: {
          canonical_url: string
          headline: string
          id: string
          match_reason: string
          news_event_id: string
          provider: string
          seen_at: string
          similarity: number | null
          source: string
        }
        Insert: {
          canonical_url: string
          headline: string
          id?: string
          match_reason: string
          news_event_id: string
          provider: string
          seen_at?: string
          similarity?: number | null
          source: string
        }
        Update: {
          canonical_url?: string
          headline?: string
          id?: string
          match_reason?: string
          news_event_id?: string
          provider?: string
          seen_at?: string
          similarity?: number | null
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "news_event_sources_news_event_id_fkey"
            columns: ["news_event_id"]
            isOneToOne: false
            referencedRelation: "news_events"
            referencedColumns: ["id"]
          },
        ]
      }
      news_events: {
        Row: {
          affected_assets: string[]
          analysis: Json | null
          analysis_model: string | null
          analysis_status: string
          analyzed_at: string | null
          canonical_url: string
          category: string
          created_at: string
          duplicate_count: number
          event_hash: string
          excerpt: string | null
          fetched_at: string
          headline: string
          id: string
          matched_terms: string[]
          news_risk: string
          provider: string
          published_at: string
          relevance_score: number
          source: string
          source_quality: string
        }
        Insert: {
          affected_assets?: string[]
          analysis?: Json | null
          analysis_model?: string | null
          analysis_status?: string
          analyzed_at?: string | null
          canonical_url: string
          category?: string
          created_at?: string
          duplicate_count?: number
          event_hash: string
          excerpt?: string | null
          fetched_at?: string
          headline: string
          id?: string
          matched_terms?: string[]
          news_risk?: string
          provider: string
          published_at: string
          relevance_score?: number
          source: string
          source_quality?: string
        }
        Update: {
          affected_assets?: string[]
          analysis?: Json | null
          analysis_model?: string | null
          analysis_status?: string
          analyzed_at?: string | null
          canonical_url?: string
          category?: string
          created_at?: string
          duplicate_count?: number
          event_hash?: string
          excerpt?: string | null
          fetched_at?: string
          headline?: string
          id?: string
          matched_terms?: string[]
          news_risk?: string
          provider?: string
          published_at?: string
          relevance_score?: number
          source?: string
          source_quality?: string
        }
        Relationships: []
      }
      order_events: {
        Row: {
          created_at: string
          event_type: string
          id: string
          order_id: string
          payload: Json | null
        }
        Insert: {
          created_at?: string
          event_type: string
          id?: string
          order_id: string
          payload?: Json | null
        }
        Update: {
          created_at?: string
          event_type?: string
          id?: string
          order_id?: string
          payload?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "order_events_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          client_order_id: string
          created_at: string
          exchange_order_id: string | null
          id: string
          order_type: string
          price: number | null
          qty: number
          raw: Json | null
          side: Database["public"]["Enums"]["trade_side"]
          status: Database["public"]["Enums"]["order_status"]
          submitted_at: string | null
          trade_id: string
          trading_mode: Database["public"]["Enums"]["trading_mode"]
        }
        Insert: {
          client_order_id: string
          created_at?: string
          exchange_order_id?: string | null
          id?: string
          order_type: string
          price?: number | null
          qty: number
          raw?: Json | null
          side?: Database["public"]["Enums"]["trade_side"]
          status?: Database["public"]["Enums"]["order_status"]
          submitted_at?: string | null
          trade_id: string
          trading_mode: Database["public"]["Enums"]["trading_mode"]
        }
        Update: {
          client_order_id?: string
          created_at?: string
          exchange_order_id?: string | null
          id?: string
          order_type?: string
          price?: number | null
          qty?: number
          raw?: Json | null
          side?: Database["public"]["Enums"]["trade_side"]
          status?: Database["public"]["Enums"]["order_status"]
          submitted_at?: string | null
          trade_id?: string
          trading_mode?: Database["public"]["Enums"]["trading_mode"]
        }
        Relationships: [
          {
            foreignKeyName: "orders_trade_id_fkey"
            columns: ["trade_id"]
            isOneToOne: false
            referencedRelation: "trades"
            referencedColumns: ["id"]
          },
        ]
      }
      paper_research_sessions: {
        Row: {
          created_at: string
          created_by: string | null
          ended_at: string | null
          ended_notified_at: string | null
          ends_at: string
          id: string
          label: string | null
          planned_days: number
          started_at: string
          starting_equity: number
          status: string
          strategy_version_id: string | null
          target_equity: number | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          ended_at?: string | null
          ended_notified_at?: string | null
          ends_at: string
          id?: string
          label?: string | null
          planned_days: number
          started_at: string
          starting_equity: number
          status?: string
          strategy_version_id?: string | null
          target_equity?: number | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          ended_at?: string | null
          ended_notified_at?: string | null
          ends_at?: string
          id?: string
          label?: string | null
          planned_days?: number
          started_at?: string
          starting_equity?: number
          status?: string
          strategy_version_id?: string | null
          target_equity?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "paper_research_sessions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "paper_research_sessions_strategy_version_id_fkey"
            columns: ["strategy_version_id"]
            isOneToOne: false
            referencedRelation: "strategy_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      portfolio_snapshots: {
        Row: {
          balance: number
          equity: number
          id: string
          open_risk: number
          taken_at: string
          trading_mode: Database["public"]["Enums"]["trading_mode"]
        }
        Insert: {
          balance: number
          equity: number
          id?: string
          open_risk?: number
          taken_at?: string
          trading_mode: Database["public"]["Enums"]["trading_mode"]
        }
        Update: {
          balance?: number
          equity?: number
          id?: string
          open_risk?: number
          taken_at?: string
          trading_mode?: Database["public"]["Enums"]["trading_mode"]
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          email: string
          id: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          email: string
          id: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          email?: string
          id?: string
        }
        Relationships: []
      }
      research_backfill_jobs: {
        Row: {
          created_at: string
          error_summary: string | null
          id: string
          records_written: number
          resume_end: string | null
          status: string
          symbol: string
          timeframe: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          error_summary?: string | null
          id?: string
          records_written?: number
          resume_end?: string | null
          status?: string
          symbol: string
          timeframe: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          error_summary?: string | null
          id?: string
          records_written?: number
          resume_end?: string | null
          status?: string
          symbol?: string
          timeframe?: string
          updated_at?: string
        }
        Relationships: []
      }
      research_daily_snapshots: {
        Row: {
          average_mae_r: number | null
          average_mfe_r: number | null
          candidates: number
          counterfactual_settled: number
          counterfactual_total: number
          created_at: string
          cumulative_r: number | null
          day_number: number
          detail: Json | null
          equity: number | null
          evidence_level: string | null
          id: string
          losses: number
          max_drawdown: number | null
          news_health: string | null
          notified_at: string | null
          qwen_health: string | null
          realized_pnl: number
          realized_r: number | null
          research_session_id: string
          scanner_health: string | null
          total_days: number
          trades_closed: number
          trades_opened: number
          utc_date: string
          wins: number
        }
        Insert: {
          average_mae_r?: number | null
          average_mfe_r?: number | null
          candidates?: number
          counterfactual_settled?: number
          counterfactual_total?: number
          created_at?: string
          cumulative_r?: number | null
          day_number: number
          detail?: Json | null
          equity?: number | null
          evidence_level?: string | null
          id?: string
          losses?: number
          max_drawdown?: number | null
          news_health?: string | null
          notified_at?: string | null
          qwen_health?: string | null
          realized_pnl?: number
          realized_r?: number | null
          research_session_id: string
          scanner_health?: string | null
          total_days: number
          trades_closed?: number
          trades_opened?: number
          utc_date: string
          wins?: number
        }
        Update: {
          average_mae_r?: number | null
          average_mfe_r?: number | null
          candidates?: number
          counterfactual_settled?: number
          counterfactual_total?: number
          created_at?: string
          cumulative_r?: number | null
          day_number?: number
          detail?: Json | null
          equity?: number | null
          evidence_level?: string | null
          id?: string
          losses?: number
          max_drawdown?: number | null
          news_health?: string | null
          notified_at?: string | null
          qwen_health?: string | null
          realized_pnl?: number
          realized_r?: number | null
          research_session_id?: string
          scanner_health?: string | null
          total_days?: number
          trades_closed?: number
          trades_opened?: number
          utc_date?: string
          wins?: number
        }
        Relationships: [
          {
            foreignKeyName: "research_daily_snapshots_research_session_id_fkey"
            columns: ["research_session_id"]
            isOneToOne: false
            referencedRelation: "paper_research_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      research_hypotheses: {
        Row: {
          created_at: string
          description: string
          evidence_level: string
          id: string
          proposed_strategy_change: Json | null
          sample_count: number
          source: string
          status: string
          supporting_metrics: Json
        }
        Insert: {
          created_at?: string
          description: string
          evidence_level: string
          id?: string
          proposed_strategy_change?: Json | null
          sample_count?: number
          source: string
          status?: string
          supporting_metrics?: Json
        }
        Update: {
          created_at?: string
          description?: string
          evidence_level?: string
          id?: string
          proposed_strategy_change?: Json | null
          sample_count?: number
          source?: string
          status?: string
          supporting_metrics?: Json
        }
        Relationships: []
      }
      signal_components: {
        Row: {
          component_name: string
          detail: Json | null
          id: string
          points_earned: number
          points_possible: number
          signal_id: string
        }
        Insert: {
          component_name: string
          detail?: Json | null
          id?: string
          points_earned: number
          points_possible: number
          signal_id: string
        }
        Update: {
          component_name?: string
          detail?: Json | null
          id?: string
          points_earned?: number
          points_possible?: number
          signal_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "signal_components_signal_id_fkey"
            columns: ["signal_id"]
            isOneToOne: false
            referencedRelation: "signals"
            referencedColumns: ["id"]
          },
        ]
      }
      signals: {
        Row: {
          ai_explanation: Json | null
          approval_delay_ms: number | null
          approval_status: Database["public"]["Enums"]["signal_approval_status"]
          approved_at: string | null
          candle_time: string
          classification: Database["public"]["Enums"]["signal_classification"]
          created_at: string
          decision_at: string | null
          decision_snapshot: Json | null
          decision_source: string | null
          entry_price: number | null
          expires_at: string | null
          id: string
          indicator_snapshot: Json | null
          maximum_allowed_entry: number | null
          minimum_allowed_entry: number | null
          news_risk: string | null
          news_snapshot: Json | null
          owner_decision: string | null
          planned_entry: number | null
          processed_at: string | null
          reason: string | null
          reference_price: number | null
          reference_price_at: string | null
          regime: string
          rejection_detail: string | null
          rejection_reason: string | null
          research_session_id: string | null
          risk_reward: number | null
          risk_snapshot: Json | null
          score: number
          stop_pct: number | null
          stop_price: number | null
          strategy_version_id: string
          symbol: string
          target_price: number | null
          timeframe: string
          trading_mode: Database["public"]["Enums"]["trading_mode"] | null
          volatility_state: string | null
        }
        Insert: {
          ai_explanation?: Json | null
          approval_delay_ms?: number | null
          approval_status?: Database["public"]["Enums"]["signal_approval_status"]
          approved_at?: string | null
          candle_time: string
          classification: Database["public"]["Enums"]["signal_classification"]
          created_at?: string
          decision_at?: string | null
          decision_snapshot?: Json | null
          decision_source?: string | null
          entry_price?: number | null
          expires_at?: string | null
          id?: string
          indicator_snapshot?: Json | null
          maximum_allowed_entry?: number | null
          minimum_allowed_entry?: number | null
          news_risk?: string | null
          news_snapshot?: Json | null
          owner_decision?: string | null
          planned_entry?: number | null
          processed_at?: string | null
          reason?: string | null
          reference_price?: number | null
          reference_price_at?: string | null
          regime: string
          rejection_detail?: string | null
          rejection_reason?: string | null
          research_session_id?: string | null
          risk_reward?: number | null
          risk_snapshot?: Json | null
          score: number
          stop_pct?: number | null
          stop_price?: number | null
          strategy_version_id: string
          symbol: string
          target_price?: number | null
          timeframe: string
          trading_mode?: Database["public"]["Enums"]["trading_mode"] | null
          volatility_state?: string | null
        }
        Update: {
          ai_explanation?: Json | null
          approval_delay_ms?: number | null
          approval_status?: Database["public"]["Enums"]["signal_approval_status"]
          approved_at?: string | null
          candle_time?: string
          classification?: Database["public"]["Enums"]["signal_classification"]
          created_at?: string
          decision_at?: string | null
          decision_snapshot?: Json | null
          decision_source?: string | null
          entry_price?: number | null
          expires_at?: string | null
          id?: string
          indicator_snapshot?: Json | null
          maximum_allowed_entry?: number | null
          minimum_allowed_entry?: number | null
          news_risk?: string | null
          news_snapshot?: Json | null
          owner_decision?: string | null
          planned_entry?: number | null
          processed_at?: string | null
          reason?: string | null
          reference_price?: number | null
          reference_price_at?: string | null
          regime?: string
          rejection_detail?: string | null
          rejection_reason?: string | null
          research_session_id?: string | null
          risk_reward?: number | null
          risk_snapshot?: Json | null
          score?: number
          stop_pct?: number | null
          stop_price?: number | null
          strategy_version_id?: string
          symbol?: string
          target_price?: number | null
          timeframe?: string
          trading_mode?: Database["public"]["Enums"]["trading_mode"] | null
          volatility_state?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "signals_research_session_id_fkey"
            columns: ["research_session_id"]
            isOneToOne: false
            referencedRelation: "paper_research_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "signals_strategy_version_id_fkey"
            columns: ["strategy_version_id"]
            isOneToOne: false
            referencedRelation: "strategy_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      strategy_experiments: {
        Row: {
          base_strategy_version_id: string
          changed_parameters: Json
          created_at: string
          dataset_snapshot: Json
          development_range: unknown
          experimental_strategy_version_id: string | null
          holdout_consumed_at: string | null
          holdout_range: unknown
          hypothesis_id: string | null
          id: string
          results: Json | null
          status: string
          validation_range: unknown
        }
        Insert: {
          base_strategy_version_id: string
          changed_parameters: Json
          created_at?: string
          dataset_snapshot: Json
          development_range: unknown
          experimental_strategy_version_id?: string | null
          holdout_consumed_at?: string | null
          holdout_range: unknown
          hypothesis_id?: string | null
          id?: string
          results?: Json | null
          status?: string
          validation_range: unknown
        }
        Update: {
          base_strategy_version_id?: string
          changed_parameters?: Json
          created_at?: string
          dataset_snapshot?: Json
          development_range?: unknown
          experimental_strategy_version_id?: string | null
          holdout_consumed_at?: string | null
          holdout_range?: unknown
          hypothesis_id?: string | null
          id?: string
          results?: Json | null
          status?: string
          validation_range?: unknown
        }
        Relationships: [
          {
            foreignKeyName: "strategy_experiments_base_strategy_version_id_fkey"
            columns: ["base_strategy_version_id"]
            isOneToOne: false
            referencedRelation: "strategy_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "strategy_experiments_experimental_strategy_version_id_fkey"
            columns: ["experimental_strategy_version_id"]
            isOneToOne: false
            referencedRelation: "strategy_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "strategy_experiments_hypothesis_id_fkey"
            columns: ["hypothesis_id"]
            isOneToOne: false
            referencedRelation: "research_hypotheses"
            referencedColumns: ["id"]
          },
        ]
      }
      strategy_parameters: {
        Row: {
          id: string
          key: string
          strategy_version_id: string
          value: Json
        }
        Insert: {
          id?: string
          key: string
          strategy_version_id: string
          value: Json
        }
        Update: {
          id?: string
          key?: string
          strategy_version_id?: string
          value?: Json
        }
        Relationships: [
          {
            foreignKeyName: "strategy_parameters_strategy_version_id_fkey"
            columns: ["strategy_version_id"]
            isOneToOne: false
            referencedRelation: "strategy_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      strategy_versions: {
        Row: {
          activated_at: string | null
          created_at: string
          description: string | null
          id: string
          name: string
          parameters: Json
          retired_at: string | null
          status: Database["public"]["Enums"]["strategy_status"]
          version_label: string
        }
        Insert: {
          activated_at?: string | null
          created_at?: string
          description?: string | null
          id?: string
          name: string
          parameters: Json
          retired_at?: string | null
          status?: Database["public"]["Enums"]["strategy_status"]
          version_label: string
        }
        Update: {
          activated_at?: string | null
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          parameters?: Json
          retired_at?: string | null
          status?: Database["public"]["Enums"]["strategy_status"]
          version_label?: string
        }
        Relationships: []
      }
      system_settings: {
        Row: {
          candidate_expiry_minutes: number
          execution_policy: string
          fee_bps: number
          fixed_risk_amount: number
          id: boolean
          live_trading_enabled: boolean
          max_atr_pct: number
          max_entry_drift_pct: number
          max_losing_trades_per_day: number
          max_market_data_age_seconds: number
          max_new_trades_per_day: number
          max_open_positions: number
          max_risk_per_trade_pct: number
          min_candidate_score: number
          min_risk_reward: number
          risk_mode: string
          signal_expiry_minutes: number
          slippage_bps: number
          trading_mode: Database["public"]["Enums"]["trading_mode"]
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          candidate_expiry_minutes?: number
          execution_policy?: string
          fee_bps?: number
          fixed_risk_amount?: number
          id?: boolean
          live_trading_enabled?: boolean
          max_atr_pct?: number
          max_entry_drift_pct?: number
          max_losing_trades_per_day?: number
          max_market_data_age_seconds?: number
          max_new_trades_per_day?: number
          max_open_positions?: number
          max_risk_per_trade_pct?: number
          min_candidate_score?: number
          min_risk_reward?: number
          risk_mode?: string
          signal_expiry_minutes?: number
          slippage_bps?: number
          trading_mode?: Database["public"]["Enums"]["trading_mode"]
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          candidate_expiry_minutes?: number
          execution_policy?: string
          fee_bps?: number
          fixed_risk_amount?: number
          id?: boolean
          live_trading_enabled?: boolean
          max_atr_pct?: number
          max_entry_drift_pct?: number
          max_losing_trades_per_day?: number
          max_market_data_age_seconds?: number
          max_new_trades_per_day?: number
          max_open_positions?: number
          max_risk_per_trade_pct?: number
          min_candidate_score?: number
          min_risk_reward?: number
          risk_mode?: string
          signal_expiry_minutes?: number
          slippage_bps?: number
          trading_mode?: Database["public"]["Enums"]["trading_mode"]
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "system_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      trade_events: {
        Row: {
          created_at: string
          event_type: string
          id: string
          payload: Json | null
          trade_id: string
        }
        Insert: {
          created_at?: string
          event_type: string
          id?: string
          payload?: Json | null
          trade_id: string
        }
        Update: {
          created_at?: string
          event_type?: string
          id?: string
          payload?: Json | null
          trade_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trade_events_trade_id_fkey"
            columns: ["trade_id"]
            isOneToOne: false
            referencedRelation: "trades"
            referencedColumns: ["id"]
          },
        ]
      }
      trade_reviews: {
        Row: {
          ai_interpretation: Json | null
          ai_summary: Json | null
          created_at: string
          factual_review: Json | null
          id: string
          trade_id: string
        }
        Insert: {
          ai_interpretation?: Json | null
          ai_summary?: Json | null
          created_at?: string
          factual_review?: Json | null
          id?: string
          trade_id: string
        }
        Update: {
          ai_interpretation?: Json | null
          ai_summary?: Json | null
          created_at?: string
          factual_review?: Json | null
          id?: string
          trade_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trade_reviews_trade_id_fkey"
            columns: ["trade_id"]
            isOneToOne: true
            referencedRelation: "trades"
            referencedColumns: ["id"]
          },
        ]
      }
      trades: {
        Row: {
          closed_at: string | null
          created_at: string
          entry_fee: number | null
          entry_price: number | null
          equity_after: number | null
          equity_before: number | null
          exit_fee: number | null
          exit_price: number | null
          exit_reason: string | null
          fees: number
          gross_pnl: number | null
          id: string
          mae_price: number | null
          mae_r: number | null
          mfe_price: number | null
          mfe_r: number | null
          modeled_max_loss: number | null
          notional: number | null
          opened_at: string | null
          pnl: number | null
          qty: number | null
          r_multiple: number | null
          rejection_reason: string | null
          research_session_id: string | null
          risk_amount: number | null
          risk_budget: number | null
          risk_reward: number | null
          side: Database["public"]["Enums"]["trade_side"]
          signal_id: string | null
          slippage: number
          status: Database["public"]["Enums"]["trade_status"]
          stop_price: number | null
          strategy_version_id: string
          symbol: string
          target_price: number | null
          trading_mode: Database["public"]["Enums"]["trading_mode"]
        }
        Insert: {
          closed_at?: string | null
          created_at?: string
          entry_fee?: number | null
          entry_price?: number | null
          equity_after?: number | null
          equity_before?: number | null
          exit_fee?: number | null
          exit_price?: number | null
          exit_reason?: string | null
          fees?: number
          gross_pnl?: number | null
          id?: string
          mae_price?: number | null
          mae_r?: number | null
          mfe_price?: number | null
          mfe_r?: number | null
          modeled_max_loss?: number | null
          notional?: number | null
          opened_at?: string | null
          pnl?: number | null
          qty?: number | null
          r_multiple?: number | null
          rejection_reason?: string | null
          research_session_id?: string | null
          risk_amount?: number | null
          risk_budget?: number | null
          risk_reward?: number | null
          side?: Database["public"]["Enums"]["trade_side"]
          signal_id?: string | null
          slippage?: number
          status?: Database["public"]["Enums"]["trade_status"]
          stop_price?: number | null
          strategy_version_id: string
          symbol: string
          target_price?: number | null
          trading_mode: Database["public"]["Enums"]["trading_mode"]
        }
        Update: {
          closed_at?: string | null
          created_at?: string
          entry_fee?: number | null
          entry_price?: number | null
          equity_after?: number | null
          equity_before?: number | null
          exit_fee?: number | null
          exit_price?: number | null
          exit_reason?: string | null
          fees?: number
          gross_pnl?: number | null
          id?: string
          mae_price?: number | null
          mae_r?: number | null
          mfe_price?: number | null
          mfe_r?: number | null
          modeled_max_loss?: number | null
          notional?: number | null
          opened_at?: string | null
          pnl?: number | null
          qty?: number | null
          r_multiple?: number | null
          rejection_reason?: string | null
          research_session_id?: string | null
          risk_amount?: number | null
          risk_budget?: number | null
          risk_reward?: number | null
          side?: Database["public"]["Enums"]["trade_side"]
          signal_id?: string | null
          slippage?: number
          status?: Database["public"]["Enums"]["trade_status"]
          stop_price?: number | null
          strategy_version_id?: string
          symbol?: string
          target_price?: number | null
          trading_mode?: Database["public"]["Enums"]["trading_mode"]
        }
        Relationships: [
          {
            foreignKeyName: "trades_research_session_id_fkey"
            columns: ["research_session_id"]
            isOneToOne: false
            referencedRelation: "paper_research_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trades_signal_id_fkey"
            columns: ["signal_id"]
            isOneToOne: false
            referencedRelation: "signals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trades_strategy_version_id_fkey"
            columns: ["strategy_version_id"]
            isOneToOne: false
            referencedRelation: "strategy_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      universe_members: {
        Row: {
          added_at: string
          id: string
          instrument_id: string
          paper_enabled: boolean
          research_enabled: boolean
          shadow_enabled: boolean
          universe_id: string
          updated_at: string
        }
        Insert: {
          added_at?: string
          id?: string
          instrument_id: string
          paper_enabled?: boolean
          research_enabled?: boolean
          shadow_enabled?: boolean
          universe_id: string
          updated_at?: string
        }
        Update: {
          added_at?: string
          id?: string
          instrument_id?: string
          paper_enabled?: boolean
          research_enabled?: boolean
          shadow_enabled?: boolean
          universe_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "universe_members_instrument_id_fkey"
            columns: ["instrument_id"]
            isOneToOne: false
            referencedRelation: "instruments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "universe_members_universe_id_fkey"
            columns: ["universe_id"]
            isOneToOne: false
            referencedRelation: "universes"
            referencedColumns: ["id"]
          },
        ]
      }
      universes: {
        Row: {
          asset_class: string
          created_at: string
          enabled: boolean
          id: string
          key: string
          name: string
          notes: string | null
          purpose: string
          updated_at: string
          venue_id: string | null
        }
        Insert: {
          asset_class: string
          created_at?: string
          enabled?: boolean
          id?: string
          key: string
          name: string
          notes?: string | null
          purpose: string
          updated_at?: string
          venue_id?: string | null
        }
        Update: {
          asset_class?: string
          created_at?: string
          enabled?: boolean
          id?: string
          key?: string
          name?: string
          notes?: string | null
          purpose?: string
          updated_at?: string
          venue_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "universes_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      venues: {
        Row: {
          asset_classes: string[]
          created_at: string
          id: string
          name: string
          notes: string | null
        }
        Insert: {
          asset_classes: string[]
          created_at?: string
          id: string
          name: string
          notes?: string | null
        }
        Update: {
          asset_classes?: string[]
          created_at?: string
          id?: string
          name?: string
          notes?: string | null
        }
        Relationships: []
      }
      weekly_reports: {
        Row: {
          created_at: string
          id: string
          summary: Json
          trading_mode: Database["public"]["Enums"]["trading_mode"]
          week_end: string
          week_start: string
        }
        Insert: {
          created_at?: string
          id?: string
          summary: Json
          trading_mode: Database["public"]["Enums"]["trading_mode"]
          week_end: string
          week_start: string
        }
        Update: {
          created_at?: string
          id?: string
          summary?: Json
          trading_mode?: Database["public"]["Enums"]["trading_mode"]
          week_end?: string
          week_start?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      app_vault_get_secret: { Args: { secret_name: string }; Returns: string }
      app_vault_set_secret: {
        Args: { secret_name: string; secret_value: string }
        Returns: undefined
      }
      get_davinki_scanner_credentials: { Args: never; Returns: Json }
      owner_create_guest: {
        Args: { p_display_name?: string; p_email: string; p_password: string }
        Returns: {
          created_at: string
          display_name: string
          email: string
          id: string
          last_sign_in_at: string
          role: string
        }[]
      }
      owner_delete_guest: { Args: { p_user_id: string }; Returns: string }
      owner_get_integration_configuration: {
        Args: { p_integration: string }
        Returns: Json
      }
      owner_list_auth_users: {
        Args: never
        Returns: {
          created_at: string
          display_name: string
          email: string
          id: string
          last_sign_in_at: string
          role: string
        }[]
      }
      owner_reset_guest_password: {
        Args: { p_password: string; p_user_id: string }
        Returns: string
      }
      owner_set_integration_configuration: {
        Args: { p_config?: Json; p_integration: string; p_secret?: string }
        Returns: undefined
      }
      venue_asset_classes_are_valid: {
        Args: { classes: string[] }
        Returns: boolean
      }
    }
    Enums: {
      backtest_split: "DEVELOPMENT" | "VALIDATION" | "HOLDOUT"
      job_status: "RUNNING" | "SUCCEEDED" | "FAILED" | "NOOP"
      lesson_status: "UNREAD" | "READ" | "COMPLETED"
      order_status:
        | "PENDING"
        | "SUBMITTED"
        | "FILLED"
        | "PARTIALLY_FILLED"
        | "CANCELLED"
        | "REJECTED"
        | "EXPIRED"
        | "UNKNOWN"
      signal_approval_status:
        | "PENDING"
        | "APPROVED"
        | "REJECTED"
        | "EXPIRED"
        | "NOT_APPLICABLE"
        | "OPENING"
        | "ERROR"
      signal_classification: "IGNORE" | "LOG" | "WATCH" | "CANDIDATE"
      strategy_status:
        | "DRAFT"
        | "BACKTESTING"
        | "PAPER_APPROVED"
        | "DEMO_APPROVED"
        | "RETIRED"
      trade_side: "LONG"
      trade_status: "OPEN" | "CLOSED" | "CANCELLED" | "REJECTED"
      trading_mode: "OBSERVE" | "PAPER" | "DEMO" | "LIVE"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
      backtest_split: ["DEVELOPMENT", "VALIDATION", "HOLDOUT"],
      job_status: ["RUNNING", "SUCCEEDED", "FAILED", "NOOP"],
      lesson_status: ["UNREAD", "READ", "COMPLETED"],
      order_status: [
        "PENDING",
        "SUBMITTED",
        "FILLED",
        "PARTIALLY_FILLED",
        "CANCELLED",
        "REJECTED",
        "EXPIRED",
        "UNKNOWN",
      ],
      signal_approval_status: [
        "PENDING",
        "APPROVED",
        "REJECTED",
        "EXPIRED",
        "NOT_APPLICABLE",
        "OPENING",
        "ERROR",
      ],
      signal_classification: ["IGNORE", "LOG", "WATCH", "CANDIDATE"],
      strategy_status: [
        "DRAFT",
        "BACKTESTING",
        "PAPER_APPROVED",
        "DEMO_APPROVED",
        "RETIRED",
      ],
      trade_side: ["LONG"],
      trade_status: ["OPEN", "CLOSED", "CANCELLED", "REJECTED"],
      trading_mode: ["OBSERVE", "PAPER", "DEMO", "LIVE"],
    },
  },
} as const
