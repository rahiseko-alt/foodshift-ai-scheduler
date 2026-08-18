'use client';

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { AdminNavbar } from '@/components/navigation/AdminNavbar';
import { ShiftOptimizeRequest } from '@/lib/types';
import { loadSavedRequest, saveRequest } from '@/lib/storage';
import { DEMO_IZAKAYA_DATA } from '@/lib/mock-data';
import {
  BusinessType,
  BusinessTypeProfile,
  FourValuePreset,
  ReservationInput,
} from '@/lib/forecasting/types';
import { BUSINESS_PROFILES, getProfileByType } from '@/lib/forecasting/presets';
import { generateDemandForecast } from '@/lib/forecasting/predictor';
import {
  mapForecastToSlotRequirements,
  applyForecastToOptimizeRequest,
} from '@/lib/forecasting/labor-mapper';

export default function ForecastAdminPage() {
  const [requestData, setRequestData] = useState<ShiftOptimizeRequest>(DEMO_IZAKAYA_DATA);
  const [selectedBusinessType, setSelectedBusinessType] = useState<BusinessType>('izakaya');
  const [customProfile, setCustomProfile] = useState<BusinessTypeProfile>(BUSINESS_PROFILES.izakaya);
  const [targetLp, setTargetLp] = useState<number>(5800);
  const [averageHourlyWage, setAverageHourlyWage] = useState<number>(1150);
  const [minOperatingStaff, setMinOperatingStaff] = useState<number>(2);
  const [selectedDayIndex, setSelectedDayIndex] = useState<number>(0);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // シミュレーション用パラメータ
  const [simulatedReservations, setSimulatedReservations] = useState<number>(0); // ピーク時追加予約人数
  const [weatherCondition, setWeatherCondition] = useState<'sunny' | 'cloudy' | 'rainy' | 'storm'>('sunny');

  // 初期ロード
  useEffect(() => {
    const saved = loadSavedRequest();
    setRequestData(saved);
  }, []);

  // 業態変更時
  const handleBusinessTypeChange = (type: BusinessType) => {
    setSelectedBusinessType(type);
    const profile = getProfileByType(type);
    setCustomProfile(JSON.parse(JSON.stringify(profile)));
    setTargetLp(profile.default_target_labor_productivity);
    setMinOperatingStaff(profile.fixed_labor_settings.min_operating_staff);
  };

  // 4値プリセットの手動変更ハンドラ
  const handlePresetChange = (
    part: keyof FourValuePreset,
    field: 'customers' | 'avg_spend',
    val: number
  ) => {
    setCustomProfile((prev) => ({
      ...prev,
      presets: {
        ...prev.presets,
        [part]: {
          ...prev.presets[part],
          [field]: Math.max(0, val),
        },
      },
    }));
  };

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  // 予測計算の実行
  const forecastResult = useMemo(() => {
    const profileToUse: BusinessTypeProfile = {
      ...customProfile,
      id: selectedBusinessType,
      default_target_labor_productivity: targetLp,
      fixed_labor_settings: {
        ...customProfile.fixed_labor_settings,
        min_operating_staff: minOperatingStaff,
      },
    };

    // シミュレーション予約の構築（金・土・日等のピーク19時に追加）
    const reservations: ReservationInput[] = [];
    if (simulatedReservations > 0) {
      const startDate = new Date(requestData.period.start_date);
      for (let i = 0; i < requestData.period.days; i++) {
        const d = new Date(startDate);
        d.setDate(startDate.getDate() + i);
        const dayOfWeek = d.getDay();
        const dateStr = d.toISOString().split('T')[0];

        // 週末または金曜日に予約を設定
        if (dayOfWeek === 5 || dayOfWeek === 6 || dayOfWeek === 0) {
          reservations.push({
            date: dateStr,
            hour: 19,
            guest_count: simulatedReservations,
          });
        }
      }
    }

    const weatherMap: Record<string, 'sunny' | 'cloudy' | 'rainy' | 'storm'> = {};
    const startDate = new Date(requestData.period.start_date);
    for (let i = 0; i < requestData.period.days; i++) {
      const d = new Date(startDate);
      d.setDate(startDate.getDate() + i);
      const dateStr = d.toISOString().split('T')[0];
      weatherMap[dateStr] = weatherCondition;
    }

    return generateDemandForecast({
      business_profile: profileToUse,
      start_date: requestData.period.start_date,
      days: requestData.period.days || 7,
      target_labor_productivity: targetLp,
      average_hourly_wage: averageHourlyWage,
      reservations,
      weather_forecast: weatherMap,
    });
  }, [
    customProfile,
    selectedBusinessType,
    targetLp,
    minOperatingStaff,
    averageHourlyWage,
    requestData.period.start_date,
    requestData.period.days,
    simulatedReservations,
    weatherCondition,
  ]);

  // 選択日のシフト枠別必要人数
  const selectedDayForecast = forecastResult.daily_forecasts[selectedDayIndex] || forecastResult.daily_forecasts[0];
  const slotRequirements = useMemo(() => {
    if (!selectedDayForecast) return [];
    return mapForecastToSlotRequirements([selectedDayForecast], requestData.shifts);
  }, [selectedDayForecast, requestData.shifts]);

  // ワンクリックでシフト設定（ShiftOptimizeRequest）に反映
  const handleApplyToShiftRequirements = () => {
    const updatedRequest = applyForecastToOptimizeRequest(requestData, forecastResult);
    setRequestData(updatedRequest);
    saveRequest(updatedRequest);
    showToast('需要予測結果をシフト必要人数に反映・保存しました！');
  };

  // チャート用の最大売上（スケーリング用）
  const maxHourlySales = useMemo(() => {
    if (!selectedDayForecast) return 100000;
    const max = Math.max(...selectedDayForecast.hourly.map((h) => h.predicted_sales), 50000);
    return Math.ceil(max / 10000) * 10000;
  }, [selectedDayForecast]);

  // チャート用の最大人数（スケーリング用）
  const maxHourlyStaff = useMemo(() => {
    if (!selectedDayForecast) return 6;
    const max = Math.max(...selectedDayForecast.hourly.map((h) => h.recommended_staff), 4);
    return Math.max(max + 1, 5);
  }, [selectedDayForecast]);

  return (
    <div style={{ maxWidth: '1280px', margin: '0 auto', padding: '1rem' }}>
      <AdminNavbar />

      {/* トースト通知 */}
      {toastMessage && (
        <div
          style={{
            position: 'fixed',
            bottom: '2rem',
            right: '2rem',
            backgroundColor: '#10b981',
            color: '#ffffff',
            padding: '1rem 1.5rem',
            borderRadius: '8px',
            boxShadow: '0 8px 24px rgba(0,0,0,0.2)',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem',
            fontWeight: 600,
            animation: 'fadeIn 0.2s ease',
          }}
        >
          <span>{toastMessage}</span>
          <Link
            href="/admin"
            className="btn btn-sm"
            style={{ backgroundColor: '#ffffff', color: '#10b981', marginLeft: '0.5rem' }}
          >
            シフト作成へ →
          </Link>
        </div>
      )}

      {/* ページヘッダー */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          flexWrap: 'wrap',
          gap: '1rem',
          marginBottom: '1.5rem',
        }}
      >
        <div>
          <h1 style={{ fontSize: '1.625rem', fontWeight: 800, margin: '0 0 0.5rem 0' }}>
            売上・需要予測シミュレーター
          </h1>
          <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.875rem' }}>
            階層ベイズ更新 × トップダウン時間分解 × 2層構造エンジンで、売上予測と推奨必要人数を瞬時に算出・連携します。
          </p>
        </div>

        <button
          onClick={handleApplyToShiftRequirements}
          className="btn btn-primary"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.5rem',
            fontSize: '0.95rem',
            padding: '0.75rem 1.25rem',
            boxShadow: '0 4px 12px rgba(99, 102, 241, 0.3)',
          }}
        >
          <span>この予測をシフト必要人数に反映する</span>
        </button>
      </div>

      {/* メインKPIサマリーカード */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '1rem',
          marginBottom: '1.5rem',
        }}
      >
        <div className="card" style={{ padding: '1.25rem' }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600, marginBottom: '0.25rem' }}>
            予測総売上（{forecastResult.days}日間）
          </div>
          <div style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--primary)' }}>
            ¥{forecastResult.summary.total_sales.toLocaleString()}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
            1日平均 ¥{Math.round(forecastResult.summary.total_sales / forecastResult.days).toLocaleString()}
          </div>
        </div>

        <div className="card" style={{ padding: '1.25rem' }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600, marginBottom: '0.25rem' }}>
            予測総客数 / 平均単価
          </div>
          <div style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--text-main)' }}>
            {forecastResult.summary.total_customers.toLocaleString()} 名
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
            客単価 ¥
            {forecastResult.summary.total_customers > 0
              ? Math.round(forecastResult.summary.total_sales / forecastResult.summary.total_customers).toLocaleString()
              : 0}
          </div>
        </div>

        <div className="card" style={{ padding: '1.25rem' }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600, marginBottom: '0.25rem' }}>
            推奨総労働時間（工数）
          </div>
          <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#f59e0b' }}>
            {forecastResult.summary.total_labor_hours} 人時
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
            想定人件費 ¥{(forecastResult.summary.total_labor_hours * averageHourlyWage).toLocaleString()}
          </div>
        </div>

        <div className="card" style={{ padding: '1.25rem' }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600, marginBottom: '0.25rem' }}>
            想定人件費率 / 人時売上高
          </div>
          <div style={{ fontSize: '1.5rem', fontWeight: 800, color: forecastResult.summary.average_labor_cost_ratio > 30 ? '#ef4444' : '#10b981' }}>
            {forecastResult.summary.average_labor_cost_ratio}%
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
            人時売上高 ¥{forecastResult.summary.average_labor_productivity.toLocaleString()}/人時
          </div>
        </div>
      </div>

      {/* 2カラムレイアウト: 左側 パラメータ設定, 右側 グラフ & シフト枠プレビュー */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(320px, 380px) 1fr', gap: '1.5rem', alignItems: 'start' }}>
        {/* 左側: 設定・シミュレータパネル */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {/* 業態選択 */}
          <div className="card" style={{ padding: '1.25rem' }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 700, margin: '0 0 1rem 0' }}>
              業態プロファイル
            </h3>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1rem' }}>
              {(Object.keys(BUSINESS_PROFILES) as BusinessType[]).map((type) => {
                const p = BUSINESS_PROFILES[type];
                const isSelected = selectedBusinessType === type;
                return (
                  <button
                    key={type}
                    type="button"
                    data-testid={`btn-profile-${type}`}
                    onClick={() => handleBusinessTypeChange(type)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '0.625rem 0.875rem',
                      borderRadius: '6px',
                      border: isSelected ? '2px solid var(--primary)' : '1px solid var(--border)',
                      backgroundColor: isSelected ? 'rgba(99, 102, 241, 0.08)' : 'var(--surface)',
                      textAlign: 'left',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: isSelected ? 700 : 500, fontSize: '0.875rem' }}>
                        {p.name}
                      </div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                        基準L/P: ¥{p.default_target_labor_productivity.toLocaleString()}
                      </div>
                    </div>
                    {isSelected && <span style={{ color: 'var(--primary)', fontWeight: 800 }}></span>}
                  </button>
                );
              })}
            </div>

            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: 0 }}>
              {customProfile.description}
            </p>
          </div>

          {/* 4値初期プリセット設定 */}
          <div className="card" style={{ padding: '1.25rem' }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 700, margin: '0 0 0.75rem 0' }}>
              4値初期設定（客数・客単価）
            </h3>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              {/* 平日昼 */}
              <div style={{ background: 'var(--bg)', padding: '0.75rem', borderRadius: '6px' }}>
                <div style={{ fontSize: '0.75rem', fontWeight: 700, marginBottom: '0.5rem', color: 'var(--primary)' }}>
                  平日 昼
                </div>
                <div style={{ marginBottom: '0.5rem' }}>
                  <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block' }}>客数 (人)</label>
                  <input
                    type="number"
                    value={customProfile.presets.weekday_lunch.customers}
                    onChange={(e) => handlePresetChange('weekday_lunch', 'customers', Number(e.target.value))}
                    className="input input-sm"
                    style={{ width: '100%' }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block' }}>客単価 (円)</label>
                  <input
                    type="number"
                    value={customProfile.presets.weekday_lunch.avg_spend}
                    onChange={(e) => handlePresetChange('weekday_lunch', 'avg_spend', Number(e.target.value))}
                    className="input input-sm"
                    style={{ width: '100%' }}
                  />
                </div>
              </div>

              {/* 平日夜 */}
              <div style={{ background: 'var(--bg)', padding: '0.75rem', borderRadius: '6px' }}>
                <div style={{ fontSize: '0.75rem', fontWeight: 700, marginBottom: '0.5rem', color: '#6366f1' }}>
                  平日 夜
                </div>
                <div style={{ marginBottom: '0.5rem' }}>
                  <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block' }}>客数 (人)</label>
                  <input
                    type="number"
                    value={customProfile.presets.weekday_dinner.customers}
                    onChange={(e) => handlePresetChange('weekday_dinner', 'customers', Number(e.target.value))}
                    className="input input-sm"
                    style={{ width: '100%' }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block' }}>客単価 (円)</label>
                  <input
                    type="number"
                    value={customProfile.presets.weekday_dinner.avg_spend}
                    onChange={(e) => handlePresetChange('weekday_dinner', 'avg_spend', Number(e.target.value))}
                    className="input input-sm"
                    style={{ width: '100%' }}
                  />
                </div>
              </div>

              {/* 休日昼 */}
              <div style={{ background: 'var(--bg)', padding: '0.75rem', borderRadius: '6px' }}>
                <div style={{ fontSize: '0.75rem', fontWeight: 700, marginBottom: '0.5rem', color: '#f59e0b' }}>
                  休日 昼
                </div>
                <div style={{ marginBottom: '0.5rem' }}>
                  <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block' }}>客数 (人)</label>
                  <input
                    type="number"
                    value={customProfile.presets.weekend_lunch.customers}
                    onChange={(e) => handlePresetChange('weekend_lunch', 'customers', Number(e.target.value))}
                    className="input input-sm"
                    style={{ width: '100%' }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block' }}>客単価 (円)</label>
                  <input
                    type="number"
                    value={customProfile.presets.weekend_lunch.avg_spend}
                    onChange={(e) => handlePresetChange('weekend_lunch', 'avg_spend', Number(e.target.value))}
                    className="input input-sm"
                    style={{ width: '100%' }}
                  />
                </div>
              </div>

              {/* 休日夜 */}
              <div style={{ background: 'var(--bg)', padding: '0.75rem', borderRadius: '6px' }}>
                <div style={{ fontSize: '0.75rem', fontWeight: 700, marginBottom: '0.5rem', color: '#ec4899' }}>
                  休日 夜
                </div>
                <div style={{ marginBottom: '0.5rem' }}>
                  <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block' }}>客数 (人)</label>
                  <input
                    type="number"
                    value={customProfile.presets.weekend_dinner.customers}
                    onChange={(e) => handlePresetChange('weekend_dinner', 'customers', Number(e.target.value))}
                    className="input input-sm"
                    style={{ width: '100%' }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block' }}>客単価 (円)</label>
                  <input
                    type="number"
                    value={customProfile.presets.weekend_dinner.avg_spend}
                    onChange={(e) => handlePresetChange('weekend_dinner', 'avg_spend', Number(e.target.value))}
                    className="input input-sm"
                    style={{ width: '100%' }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* 生産性・人件費・シミュレーション調整 */}
          <div className="card" style={{ padding: '1.25rem' }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 700, margin: '0 0 1rem 0' }}>
              生産性 & シミュレーション条件
            </h3>

            {/* 目標人時売上高 L/P */}
            <div style={{ marginBottom: '1.25rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                <label style={{ fontSize: '0.8125rem', fontWeight: 600 }}>
                  目標人時売上高 (L/P)
                </label>
                <span style={{ fontSize: '0.875rem', fontWeight: 700, color: 'var(--primary)' }}>
                  ¥{targetLp.toLocaleString()} /人時
                </span>
              </div>
              <input
                type="range"
                min={3000}
                max={10000}
                step={200}
                value={targetLp}
                onChange={(e) => setTargetLp(Number(e.target.value))}
                style={{ width: '100%', cursor: 'pointer' }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                <span>¥3,000 (手厚い)</span>
                <span>¥6,000 (標準)</span>
                <span>¥10,000 (高効率)</span>
              </div>
            </div>

            {/* 最低防犯人数 */}
            <div style={{ marginBottom: '1.25rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                <label style={{ fontSize: '0.8125rem', fontWeight: 600 }}>
                  営業中最低防犯人数 (固定アンカー)
                </label>
                <span style={{ fontSize: '0.875rem', fontWeight: 700 }}>
                  {minOperatingStaff} 名
                </span>
              </div>
              <input
                type="range"
                min={1}
                max={5}
                step={1}
                value={minOperatingStaff}
                onChange={(e) => setMinOperatingStaff(Number(e.target.value))}
                style={{ width: '100%', cursor: 'pointer' }}
              />
            </div>

            {/* ピーク予約追加シミュレータ */}
            <div style={{ marginBottom: '1.25rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                <label style={{ fontSize: '0.8125rem', fontWeight: 600 }}>
                  週末19時 確定予約人数 (Hard工数)
                </label>
                <span style={{ fontSize: '0.875rem', fontWeight: 700, color: '#f59e0b' }}>
                  +{simulatedReservations} 名
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={50}
                step={5}
                value={simulatedReservations}
                onChange={(e) => setSimulatedReservations(Number(e.target.value))}
                style={{ width: '100%', cursor: 'pointer' }}
              />
            </div>

            {/* 天候シミュレータ */}
            <div>
              <label style={{ fontSize: '0.8125rem', fontWeight: 600, display: 'block', marginBottom: '0.35rem' }}>
                天候シミュレーション
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.35rem' }}>
                {[
                  { key: 'sunny', label: '晴天 (1.0)' },
                  { key: 'cloudy', label: '曇り (0.98)' },
                  { key: 'rainy', label: '雨天 (0.85)' },
                  { key: 'storm', label: '荒天 (0.60)' },
                ].map((w) => (
                  <button
                    key={w.key}
                    type="button"
                    onClick={() => setWeatherCondition(w.key as any)}
                    className={`btn btn-sm ${weatherCondition === w.key ? 'btn-primary' : 'btn-secondary'}`}
                    style={{ fontSize: '0.7rem', padding: '0.4rem 0.2rem' }}
                  >
                    {w.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* 右側: 日別カード & 24時間詳細グラフ & シフト枠連携プレビュー */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {/* 日別タブセレクター */}
          <div className="card" style={{ padding: '1rem' }}>
            <div style={{ fontSize: '0.8125rem', fontWeight: 700, marginBottom: '0.75rem' }}>
              日別予測一覧（クリックして時間帯詳細を表示）
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${forecastResult.daily_forecasts.length}, 1fr)`, gap: '0.5rem' }}>
              {forecastResult.daily_forecasts.map((daily, idx) => {
                const isSelected = selectedDayIndex === idx;
                const isWeekend = daily.day_of_week === 0 || daily.day_of_week === 6;
                const isPayday = daily.modifiers.is_payday_or_gotobi;

                return (
                  <button
                    key={daily.date}
                    type="button"
                    onClick={() => setSelectedDayIndex(idx)}
                    style={{
                      padding: '0.75rem 0.5rem',
                      borderRadius: '8px',
                      border: isSelected ? '2px solid var(--primary)' : '1px solid var(--border)',
                      backgroundColor: isSelected ? 'rgba(99, 102, 241, 0.12)' : 'var(--bg)',
                      textAlign: 'center',
                      cursor: 'pointer',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.25rem',
                    }}
                  >
                    <div style={{ fontSize: '0.75rem', fontWeight: 700, color: isWeekend ? '#ef4444' : 'var(--text-main)' }}>
                      {daily.date.slice(5)} ({daily.day_of_week_label})
                    </div>
                    <div style={{ fontSize: '0.8125rem', fontWeight: 800, color: 'var(--primary)' }}>
                      ¥{Math.round(daily.total_sales / 1000)}k
                    </div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                      {daily.total_customers}名 / {daily.total_recommended_labor_hours}h
                    </div>
                    {isPayday && (
                      <span
                        style={{
                          fontSize: '0.625rem',
                          backgroundColor: '#f59e0b',
                          color: '#ffffff',
                          borderRadius: '4px',
                          padding: '0.1rem 0.25rem',
                          fontWeight: 700,
                        }}
                      >
                        五十日
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 選択日の24時間詳細グラフ（SVGビジュアライゼーション） */}
          {selectedDayForecast && (
            <div className="card" style={{ padding: '1.25rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <div>
                  <h3 style={{ fontSize: '1.125rem', fontWeight: 700, margin: 0 }}>
                    {selectedDayForecast.date} ({selectedDayForecast.day_of_week_label}曜) 24時間需要 ＆ 必要人数グラフ
                  </h3>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                    日別売上: ¥{selectedDayForecast.total_sales.toLocaleString()} ｜ 客数: {selectedDayForecast.total_customers}名 ｜ 推奨総人時: {selectedDayForecast.total_recommended_labor_hours}時間
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '1rem', fontSize: '0.75rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                    <div style={{ width: '12px', height: '12px', backgroundColor: 'var(--primary)', borderRadius: '2px' }} />
                    <span>予測売上 (棒)</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                    <div style={{ width: '12px', height: '12px', backgroundColor: '#f59e0b', borderRadius: '50%' }} />
                    <span>推奨必要人数 (線)</span>
                  </div>
                </div>
              </div>

              {/* グラフコンテナ */}
              <div style={{ width: '100%', height: '240px', position: 'relative', marginTop: '1rem' }}>
                <svg width="100%" height="200" viewBox="0 0 720 200" preserveAspectRatio="none" style={{ overflow: 'visible' }}>
                  {/* 背景グリッド線 */}
                  {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
                    const y = 170 - ratio * 150;
                    return (
                      <g key={ratio}>
                        <line x1="40" y1={y} x2="710" y2={y} stroke="var(--border)" strokeDasharray="3 3" strokeWidth="1" />
                        <text x="35" y={y + 4} textAnchor="end" fontSize="10" fill="var(--text-muted)">
                          ¥{Math.round((maxHourlySales * ratio) / 1000)}k
                        </text>
                      </g>
                    );
                  })}

                  {/* 24時間の売上バー */}
                  {selectedDayForecast.hourly.map((h, i) => {
                    const x = 45 + i * 27.5;
                    const barHeight = maxHourlySales > 0 ? (h.predicted_sales / maxHourlySales) * 150 : 0;
                    const y = 170 - barHeight;
                    const isOperating = h.hour >= customProfile.open_hour && h.hour < customProfile.close_hour;

                    return (
                      <g key={h.hour}>
                        <rect
                          x={x}
                          y={y}
                          width="18"
                          height={barHeight}
                          fill={isOperating ? 'var(--primary)' : 'rgba(156, 163, 175, 0.3)'}
                          rx="3"
                          style={{ transition: 'height 0.2s ease, y 0.2s ease' }}
                        >
                          <title>
                            {h.hour}:00
                            {'\n'}予測売上: ¥{h.predicted_sales.toLocaleString()}
                            {'\n'}客数: {h.predicted_customers}名 (予約: {h.reserved_customers}名)
                            {'\n'}推奨人数: {h.recommended_staff}名 (固定: {h.fixed_staff}名 / 変動: {h.variable_staff}名)
                          </title>
                        </rect>
                        {/* 時刻ラベル */}
                        {i % 2 === 0 && (
                          <text x={x + 9} y="188" textAnchor="middle" fontSize="10" fill="var(--text-muted)">
                            {h.hour}時
                          </text>
                        )}
                      </g>
                    );
                  })}

                  {/* 推奨必要人数の折れ線 */}
                  {(() => {
                    const points = selectedDayForecast.hourly.map((h, i) => {
                      const x = 45 + i * 27.5 + 9;
                      const staffRatio = maxHourlyStaff > 0 ? h.recommended_staff / maxHourlyStaff : 0;
                      const y = 170 - staffRatio * 150;
                      return `${x},${y}`;
                    });

                    return (
                      <g>
                        <polyline
                          fill="none"
                          stroke="#f59e0b"
                          strokeWidth="2.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          points={points.join(' ')}
                        />
                        {selectedDayForecast.hourly.map((h, i) => {
                          const x = 45 + i * 27.5 + 9;
                          const staffRatio = maxHourlyStaff > 0 ? h.recommended_staff / maxHourlyStaff : 0;
                          const y = 170 - staffRatio * 150;
                          if (h.recommended_staff === 0) return null;
                          return (
                            <g key={i}>
                              <circle cx={x} cy={y} r="3.5" fill="#f59e0b" stroke="#ffffff" strokeWidth="1.5" />
                              <text x={x} y={y - 6} textAnchor="middle" fontSize="10" fontWeight="700" fill="#d97706">
                                {h.recommended_staff}
                              </text>
                            </g>
                          );
                        })}
                      </g>
                    );
                  })()}
                </svg>
              </div>
            </div>
          )}

          {/* シフト枠への集約＆反映プレビュー */}
          <div className="card" style={{ padding: '1.25rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ fontSize: '1rem', fontWeight: 700, margin: 0 }}>
                シフト枠別 必要人数集約プレビュー ({selectedDayForecast?.date})
              </h3>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                2層構造（固定アンカー＋売上変動枠）から集約
              </span>
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--border)', textAlign: 'left', color: 'var(--text-muted)' }}>
                    <th style={{ padding: '0.5rem' }}>シフト枠名</th>
                    <th style={{ padding: '0.5rem' }}>時間帯</th>
                    <th style={{ padding: '0.5rem' }}>枠内売上見込</th>
                    <th style={{ padding: '0.5rem' }}>ピーク人数</th>
                    <th style={{ padding: '0.5rem' }}>平均人数</th>
                    <th style={{ padding: '0.5rem', fontWeight: 700, color: 'var(--primary)' }}>推奨必要人数 (min_staff)</th>
                  </tr>
                </thead>
                <tbody>
                  {slotRequirements.map((slot) => (
                    <tr key={slot.shift_id} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '0.75rem 0.5rem', fontWeight: 600 }}>{slot.shift_name}</td>
                      <td style={{ padding: '0.75rem 0.5rem', color: 'var(--text-muted)' }}>
                        {slot.start_hour}:00 〜 {slot.end_hour}:00
                      </td>
                      <td style={{ padding: '0.75rem 0.5rem', fontWeight: 600 }}>
                        ¥{slot.forecast_sales_in_slot.toLocaleString()}
                      </td>
                      <td style={{ padding: '0.75rem 0.5rem' }}>{slot.peak_hour_staff} 名</td>
                      <td style={{ padding: '0.75rem 0.5rem' }}>{slot.average_hour_staff} 名</td>
                      <td style={{ padding: '0.75rem 0.5rem' }}>
                        <span
                          style={{
                            display: 'inline-block',
                            backgroundColor: 'rgba(99, 102, 241, 0.15)',
                            color: 'var(--primary)',
                            padding: '0.25rem 0.625rem',
                            borderRadius: '4px',
                            fontWeight: 800,
                            fontSize: '0.875rem',
                          }}
                        >
                          {slot.calculated_min_staff} 名
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ marginTop: '1.25rem', display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
              <Link href="/admin/shifts" className="btn btn-secondary btn-sm">
                シフト枠マスタを確認する
              </Link>
              <button
                onClick={handleApplyToShiftRequirements}
                className="btn btn-primary btn-sm"
                style={{ fontWeight: 700 }}
              >
                この予測を全日シフト必要人数に反映する
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
