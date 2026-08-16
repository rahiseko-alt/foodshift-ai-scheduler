'use client';

import React, { useEffect, useState } from 'react';
import { AdminNavbar } from '@/components/navigation/AdminNavbar';
import { ShiftOptimizeRequest, StaffMember } from '@/lib/types';
import { DEMO_IZAKAYA_DATA } from '@/lib/mock-data';
import { loadSavedRequest, saveRequest } from '@/lib/storage';
import {
  normalizeNumberInput,
  validateHourlyWage,
  calculateAge,
  isMinorFromBirthDate,
  checkDuplicateStaffName,
} from '@/lib/validation';

const ROLE_OPTIONS = [
  { id: 'kitchen_leader', label: '厨房責任者 (kitchen_leader)' },
  { id: 'hall_leader', label: 'ホール主任 (hall_leader)' },
  { id: 'kitchen', label: 'キッチン (kitchen)' },
  { id: 'hall', label: 'ホール (hall)' },
];

export default function StaffAdminPage() {
  const [requestData, setRequestData] = useState<ShiftOptimizeRequest>(DEMO_IZAKAYA_DATA);
  const [editingStaff, setEditingStaff] = useState<StaffMember | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'inactive'>('all');

  // フォームステート
  const [formId, setFormId] = useState('');
  const [formName, setFormName] = useState('');
  const [formBirthDate, setFormBirthDate] = useState('');
  const [formAgeVerified, setFormAgeVerified] = useState(false);
  const [formIsMinor, setFormIsMinor] = useState(false);
  const [formIsStudentVisa, setFormIsStudentVisa] = useState(false);
  const [formIsPregnant, setFormIsPregnant] = useState(false);
  const [formIsActive, setFormIsActive] = useState(true);
  const [formRoles, setFormRoles] = useState<string[]>(['hall']);
  const [formHourlyWageInput, setFormHourlyWageInput] = useState<string>('1150');
  const [formMaxWeeklyHoursInput, setFormMaxWeeklyHoursInput] = useState<string>('30');
  const [formTargetWeeklyHoursInput, setFormTargetWeeklyHoursInput] = useState<string>('25');
  const [formMaxConsecutiveDaysInput, setFormMaxConsecutiveDaysInput] = useState<string>('4');
  const [formMinDaysInput, setFormMinDaysInput] = useState<string>('3');
  const [formMaxDaysInput, setFormMaxDaysInput] = useState<string>('7');
  const [formNgStaffIds, setFormNgStaffIds] = useState<string[]>([]);
  const [formPreferredPartnerIds, setFormPreferredPartnerIds] = useState<string[]>([]);
  const [formYtdEarningsInput, setFormYtdEarningsInput] = useState<string>('600000');
  const [formTaxWall, setFormTaxWall] = useState<number | undefined>(1030000);
  const [formError, setFormError] = useState<string | null>(null);
  const [formWarning, setFormWarning] = useState<string | null>(null);

  useEffect(() => {
    const saved = loadSavedRequest();
    setRequestData(saved);
  }, []);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  // 生年月日変更ハンドラ (満年齢と未成年フラグを自動算出: No. 204, 261)
  const handleBirthDateChange = (bDate: string) => {
    setFormBirthDate(bDate);
    if (!bDate) return;
    const age = calculateAge(bDate);
    if (age !== null) {
      if (age < 18) {
        setFormIsMinor(true);
      } else {
        setFormIsMinor(false);
      }
    }
  };

  // 氏名変更時のリアルタイム重複検知 (No. 211)
  const handleNameChange = (name: string) => {
    setFormName(name);
    const dupCheck = checkDuplicateStaffName(name, requestData.staff_members, formId);
    if (dupCheck.isDuplicate) {
      setFormWarning(dupCheck.warning || null);
    } else {
      setFormWarning(null);
    }
  };

  // 留学生フラグ切替時 (No. 267: 週28h上限ガード)
  const handleStudentVisaToggle = (checked: boolean) => {
    setFormIsStudentVisa(checked);
    if (checked) {
      const currentMaxHours = normalizeNumberInput(formMaxWeeklyHoursInput, 30);
      if (currentMaxHours > 28) {
        setFormMaxWeeklyHoursInput('28');
        setFormTargetWeeklyHoursInput(String(Math.min(24, normalizeNumberInput(formTargetWeeklyHoursInput, 24))));
      }
    }
  };

  const handleOpenAdd = () => {
    const newId = `emp_${Date.now().toString().slice(-4)}`;
    setEditingStaff(null);
    setFormId(newId);
    setFormName('');
    setFormBirthDate('');
    setFormAgeVerified(false);
    setFormIsMinor(false);
    setFormIsStudentVisa(false);
    setFormIsPregnant(false);
    setFormIsActive(true);
    setFormRoles(['hall']);
    setFormHourlyWageInput('1150');
    setFormMaxWeeklyHoursInput('30');
    setFormTargetWeeklyHoursInput('25');
    setFormMaxConsecutiveDaysInput('4');
    setFormMinDaysInput('3');
    setFormMaxDaysInput('7');
    setFormNgStaffIds([]);
    setFormPreferredPartnerIds([]);
    setFormYtdEarningsInput('0');
    setFormTaxWall(1030000);
    setFormError(null);
    setFormWarning(null);
    setIsModalOpen(true);
  };

  const handleOpenEdit = (staff: StaffMember) => {
    setEditingStaff(staff);
    setFormId(staff.id);
    setFormName(staff.name);
    setFormBirthDate(staff.birth_date || '');
    setFormAgeVerified(staff.age_verified || false);
    setFormIsMinor(staff.is_minor);
    setFormIsStudentVisa(staff.is_student_visa || false);
    setFormIsPregnant(staff.is_pregnant_or_nursing || false);
    setFormIsActive(staff.is_active !== false);
    setFormRoles([...staff.roles]);
    setFormHourlyWageInput(String(staff.hourly_wage));
    setFormMaxWeeklyHoursInput(String(staff.max_weekly_hours));
    setFormTargetWeeklyHoursInput(String(staff.target_weekly_hours));
    setFormMaxConsecutiveDaysInput(String(staff.max_consecutive_days));
    setFormMinDaysInput(String(staff.min_days_per_period ?? 2));
    setFormMaxDaysInput(String(staff.max_days_per_period ?? 7));
    setFormNgStaffIds(staff.ng_staff_ids ? [...staff.ng_staff_ids] : []);
    setFormPreferredPartnerIds(staff.preferred_partner_ids ? [...staff.preferred_partner_ids] : []);
    setFormYtdEarningsInput(String(staff.annual_earnings_ytd ?? 0));
    setFormTaxWall(staff.tax_wall);
    setFormError(null);
    setFormWarning(null);
    setIsModalOpen(true);
  };

  // 在籍/休職トグル (クイック切替: No. 215)
  const handleToggleActiveQuick = (staffId: string) => {
    const updatedStaffList = requestData.staff_members.map((s) => {
      if (s.id === staffId) {
        const nextActive = s.is_active === false ? true : false;
        return { ...s, is_active: nextActive };
      }
      return s;
    });

    const updatedReq: ShiftOptimizeRequest = {
      ...requestData,
      staff_members: updatedStaffList,
    };

    setRequestData(updatedReq);
    saveRequest(updatedReq);
    const target = requestData.staff_members.find((s) => s.id === staffId);
    showToast(`「${target?.name}」のステータスを更新しました`);
  };

  const handleDeleteStaff = (staffId: string) => {
    const target = requestData.staff_members.find((s) => s.id === staffId);
    if (!target) return;
    if (!window.confirm(`「${target.name}」を完全に削除してもよろしいですか？\n（履歴や希望データも削除されます。一時的な不参加の場合は「休職・退職」設定を推奨します）`)) return;

    const updatedStaff = requestData.staff_members.filter((s) => s.id !== staffId);
    const updatedAvail = requestData.availabilities.filter((a) => a.staff_id !== staffId);
    const updatedReq: ShiftOptimizeRequest = {
      ...requestData,
      staff_members: updatedStaff,
      availabilities: updatedAvail,
    };

    setRequestData(updatedReq);
    saveRequest(updatedReq);
    showToast(`スタッフ「${target.name}」を削除しました`);
  };

  const handleResetDemo = () => {
    if (!window.confirm('スタッフマスタを初期プリセットデータにリセットしますか？')) return;
    setRequestData(DEMO_IZAKAYA_DATA);
    saveRequest(DEMO_IZAKAYA_DATA);
    showToast('初期プリセットにリセットしました');
  };

  const handleSaveForm = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const trimmedName = formName.trim();
    if (!trimmedName) {
      setFormError('スタッフ氏名を入力してください');
      return;
    }

    // 全角数字・カンマの正規化 (No. 210)
    const normalizedWage = normalizeNumberInput(formHourlyWageInput, 0);
    const wageValidation = validateHourlyWage(normalizedWage);
    if (!wageValidation.isValid) {
      setFormError(wageValidation.error || '時給を正しく入力してください');
      return;
    }

    if (formRoles.length === 0) {
      setFormError('少なくとも1つの保有ロールを選択してください');
      return;
    }

    // 留学生労働時間上限ガード (No. 267)
    let maxWeeklyHours = normalizeNumberInput(formMaxWeeklyHoursInput, 30);
    if (formIsStudentVisa && maxWeeklyHours > 28) {
      maxWeeklyHours = 28;
    }

    const calculatedAge = formBirthDate ? calculateAge(formBirthDate) : null;
    const finalIsMinor = calculatedAge !== null ? calculatedAge < 18 : formIsMinor;

    const newStaffObj: StaffMember = {
      id: formId,
      name: trimmedName,
      is_minor: finalIsMinor,
      birth_date: formBirthDate || undefined,
      age_verified: formAgeVerified,
      is_student_visa: formIsStudentVisa,
      is_pregnant_or_nursing: formIsPregnant,
      is_active: formIsActive,
      roles: formRoles,
      hourly_wage: normalizedWage,
      max_weekly_hours: maxWeeklyHours,
      target_weekly_hours: normalizeNumberInput(formTargetWeeklyHoursInput, 25),
      max_consecutive_days: Math.min(7, Math.max(1, normalizeNumberInput(formMaxConsecutiveDaysInput, 4))),
      min_days_per_period: normalizeNumberInput(formMinDaysInput, 2),
      max_days_per_period: normalizeNumberInput(formMaxDaysInput, 7),
      ng_staff_ids: formNgStaffIds.length > 0 ? formNgStaffIds : undefined,
      preferred_partner_ids: formPreferredPartnerIds.length > 0 ? formPreferredPartnerIds : undefined,
      annual_earnings_ytd: normalizeNumberInput(formYtdEarningsInput, 0),
      tax_wall: formTaxWall ? Number(formTaxWall) : undefined,
    };

    let updatedStaffList: StaffMember[];
    if (editingStaff) {
      updatedStaffList = requestData.staff_members.map((s) =>
        s.id === editingStaff.id ? newStaffObj : s
      );
    } else {
      updatedStaffList = [...requestData.staff_members, newStaffObj];
    }

    const updatedReq: ShiftOptimizeRequest = {
      ...requestData,
      staff_members: updatedStaffList,
    };

    setRequestData(updatedReq);
    saveRequest(updatedReq);
    setIsModalOpen(false);
    showToast(editingStaff ? `「${trimmedName}」を更新しました` : `新規スタッフ「${trimmedName}」を追加しました`);
  };

  const toggleRole = (roleId: string) => {
    if (formRoles.includes(roleId)) {
      setFormRoles(formRoles.filter((r) => r !== roleId));
    } else {
      setFormRoles([...formRoles, roleId]);
    }
  };

  const toggleNgStaff = (targetStaffId: string) => {
    if (formNgStaffIds.includes(targetStaffId)) {
      setFormNgStaffIds(formNgStaffIds.filter((id) => id !== targetStaffId));
    } else {
      setFormNgStaffIds([...formNgStaffIds, targetStaffId]);
    }
  };

  const togglePreferredStaff = (targetStaffId: string) => {
    if (formPreferredPartnerIds.includes(targetStaffId)) {
      setFormPreferredPartnerIds(formPreferredPartnerIds.filter((id) => id !== targetStaffId));
    } else {
      setFormPreferredPartnerIds([...formPreferredPartnerIds, targetStaffId]);
    }
  };

  // フィルタリング
  const displayedStaff = requestData.staff_members.filter((s) => {
    if (filterStatus === 'active') return s.is_active !== false;
    if (filterStatus === 'inactive') return s.is_active === false;
    return true;
  });

  const activeCount = requestData.staff_members.filter((s) => s.is_active !== false).length;
  const inactiveCount = requestData.staff_members.length - activeCount;

  return (
    <main className="container" style={{ paddingBottom: '3rem' }}>
      <AdminNavbar />

      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '1rem',
          marginBottom: '1.25rem',
        }}
      >
        <div>
          <h1 style={{ fontSize: '1.375rem', fontWeight: 700 }}>
            👥 スタッフマスタ管理
          </h1>
          <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
            在籍 {activeCount} 名 / 休職・退職 {inactiveCount} 名 | 労基法制約・時給・保有ロール・相性NGペアの設定
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button onClick={handleResetDemo} className="btn btn-secondary btn-sm">
            ↺ デモデータ復元
          </button>
          <button onClick={handleOpenAdd} className="btn btn-primary" data-testid="btn-add-staff">
            ＋ 新規スタッフ登録
          </button>
        </div>
      </header>

      {/* フィルタタブ */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
        <button
          onClick={() => setFilterStatus('all')}
          className={`btn btn-sm ${filterStatus === 'all' ? 'btn-primary' : 'btn-secondary'}`}
        >
          すべて ({requestData.staff_members.length})
        </button>
        <button
          onClick={() => setFilterStatus('active')}
          className={`btn btn-sm ${filterStatus === 'active' ? 'btn-primary' : 'btn-secondary'}`}
        >
          在籍中のみ ({activeCount})
        </button>
        {inactiveCount > 0 && (
          <button
            onClick={() => setFilterStatus('inactive')}
            className={`btn btn-sm ${filterStatus === 'inactive' ? 'btn-primary' : 'btn-secondary'}`}
          >
            休職・退職 ({inactiveCount})
          </button>
        )}
      </div>

      {toastMessage && (
        <div
          style={{
            backgroundColor: 'var(--success-bg)',
            color: 'var(--success)',
            border: '1px solid var(--success-border)',
            padding: '0.75rem 1rem',
            borderRadius: 'var(--radius-sm)',
            marginBottom: '1rem',
            fontWeight: 600,
            fontSize: '0.875rem',
          }}
        >
          ✓ {toastMessage}
        </div>
      )}

      {/* スタッフ一覧テーブル */}
      <div className="card" style={{ padding: '0', overflowX: 'auto' }}>
        <table className="modern-table" style={{ minWidth: '1020px' }}>
          <thead>
            <tr>
              <th style={{ width: '220px' }}>氏名 / 属性・ステータス</th>
              <th>保有ロール</th>
              <th style={{ width: '90px' }}>時給</th>
              <th style={{ width: '130px' }}>週間/連勤上限</th>
              <th style={{ width: '140px' }}>NGペア / 希望ペア</th>
              <th style={{ width: '150px' }}>年収の壁 / 累計</th>
              <th style={{ width: '150px', textAlign: 'right' }}>状態 / 操作</th>
            </tr>
          </thead>
          <tbody>
            {displayedStaff.map((staff) => {
              const ngNames = (staff.ng_staff_ids || [])
                .map((id) => requestData.staff_members.find((s) => s.id === id)?.name.split(' ')[0])
                .filter(Boolean);

              const prefNames = (staff.preferred_partner_ids || [])
                .map((id) => requestData.staff_members.find((s) => s.id === id)?.name.split(' ')[0])
                .filter(Boolean);

              const isInactive = staff.is_active === false;
              const age = staff.birth_date ? calculateAge(staff.birth_date) : null;

              return (
                <tr
                  key={staff.id}
                  data-testid={`staff-item-${staff.id}`}
                  style={{
                    opacity: isInactive ? 0.6 : 1,
                    backgroundColor: isInactive ? '#f8fafc' : 'inherit',
                  }}
                >
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                      <span style={{ fontWeight: 600, textDecoration: isInactive ? 'line-through' : 'none' }}>
                        {staff.name}
                      </span>
                      {isInactive && (
                        <span className="badge badge-muted" style={{ fontSize: '0.65rem' }}>
                          休職・退職
                        </span>
                      )}
                    </div>

                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem', marginTop: '0.25rem' }}>
                      {staff.is_minor ? (
                        <span className="badge badge-danger" style={{ fontSize: '0.7rem' }}>
                          {age !== null ? `満${age}歳 (年少者)` : '満18歳未満 (深夜不可)'}
                        </span>
                      ) : (
                        <span className="badge badge-muted" style={{ fontSize: '0.7rem' }}>
                          {age !== null ? `満${age}歳 (一般)` : '一般 (深夜可)'}
                        </span>
                      )}

                      {staff.is_student_visa && (
                        <span className="badge badge-warning" style={{ fontSize: '0.7rem' }}>
                          留学生 (週28h)
                        </span>
                      )}

                      {staff.is_pregnant_or_nursing && (
                        <span className="badge badge-warning" style={{ fontSize: '0.7rem' }}>
                          母性保護
                        </span>
                      )}
                    </div>
                  </td>
                  <td>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem' }}>
                      {staff.roles.map((r) => (
                        <span
                          key={r}
                          className={
                            r.includes('leader')
                              ? 'badge badge-primary'
                              : 'badge badge-muted'
                          }
                        >
                          {r}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td>
                    <span style={{ fontWeight: 600 }}>¥{staff.hourly_wage.toLocaleString()}</span>
                  </td>
                  <td>
                    <div style={{ fontSize: '0.75rem' }}>
                      週: <strong>{staff.max_weekly_hours}h</strong> (目標 {staff.target_weekly_hours}h)
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      連勤上限: {staff.max_consecutive_days}日
                    </div>
                  </td>
                  <td>
                    {ngNames.length > 0 && (
                      <div style={{ fontSize: '0.75rem', color: 'var(--danger)', marginBottom: '2px' }}>
                        🚫 NG: {ngNames.join(', ')}
                      </div>
                    )}
                    {prefNames.length > 0 && (
                      <div style={{ fontSize: '0.75rem', color: 'var(--success)' }}>
                        🤝 ペア: {prefNames.join(', ')}
                      </div>
                    )}
                    {ngNames.length === 0 && prefNames.length === 0 && (
                      <span style={{ color: 'var(--text-dim)', fontSize: '0.75rem' }}>なし</span>
                    )}
                  </td>
                  <td>
                    {staff.tax_wall ? (
                      <div>
                        <span className="badge badge-warning" style={{ fontSize: '0.7rem' }}>
                          壁: {(staff.tax_wall / 10000).toFixed(0)}万円
                        </span>
                        <div style={{ fontSize: '0.75rem', marginTop: '2px', color: 'var(--text-muted)' }}>
                          累計: ¥{(staff.annual_earnings_ytd || 0).toLocaleString()}
                        </div>
                      </div>
                    ) : (
                      <span style={{ color: 'var(--text-dim)', fontSize: '0.75rem' }}>設定なし</span>
                    )}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <div style={{ display: 'inline-flex', gap: '0.25rem', alignItems: 'center' }}>
                      <button
                        onClick={() => handleToggleActiveQuick(staff.id)}
                        className="btn btn-secondary btn-sm"
                        style={{ fontSize: '0.7rem', padding: '0.2rem 0.4rem' }}
                        title={isInactive ? '在籍中に戻す' : '休職・退職に設定'}
                      >
                        {isInactive ? '復職' : '休退'}
                      </button>
                      <button
                        onClick={() => handleOpenEdit(staff)}
                        className="btn btn-secondary btn-sm"
                        data-testid={`btn-edit-${staff.id}`}
                      >
                        編集
                      </button>
                      <button
                        onClick={() => handleDeleteStaff(staff.id)}
                        className="btn btn-danger btn-sm"
                        data-testid={`btn-delete-${staff.id}`}
                      >
                        削除
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* 新規登録 / 編集 モーダル */}
      {isModalOpen && (
        <div className="modal-overlay" onClick={() => setIsModalOpen(false)}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '620px' }}>
            <h2 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '1rem' }}>
              {editingStaff ? `スタッフ編集: ${editingStaff.name}` : '新規スタッフ登録'}
            </h2>

            {formError && (
              <div
                style={{
                  backgroundColor: 'var(--danger-bg)',
                  color: 'var(--danger)',
                  border: '1px solid var(--danger-border)',
                  padding: '0.5rem 0.75rem',
                  borderRadius: 'var(--radius-sm)',
                  marginBottom: '1rem',
                  fontSize: '0.8125rem',
                }}
              >
                ⚠ {formError}
              </div>
            )}

            {formWarning && (
              <div
                style={{
                  backgroundColor: 'var(--warning-bg)',
                  color: '#854d0e',
                  border: '1px solid var(--warning-border)',
                  padding: '0.5rem 0.75rem',
                  borderRadius: 'var(--radius-sm)',
                  marginBottom: '1rem',
                  fontSize: '0.8125rem',
                }}
              >
                💡 {formWarning}
              </div>
            )}

            <form onSubmit={handleSaveForm}>
              <div className="form-group">
                <label className="form-label">氏名・表示名 (必須)</label>
                <input
                  type="text"
                  className="form-input"
                  value={formName}
                  onChange={(e) => handleNameChange(e.target.value)}
                  placeholder="例: 佐藤 健 (大2/キッチン)"
                  required
                />
              </div>

              {/* 生年月日 ＆ 満年齢自動計算 (No. 204, 261) */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div className="form-group">
                  <label className="form-label">生年月日 (満年齢自動判定)</label>
                  <input
                    type="date"
                    className="form-input"
                    value={formBirthDate}
                    onChange={(e) => handleBirthDateChange(e.target.value)}
                  />
                  {formBirthDate && (
                    <div style={{ fontSize: '0.75rem', marginTop: '0.25rem', color: 'var(--text-muted)' }}>
                      現在: <strong>満{calculateAge(formBirthDate) ?? '-'}歳</strong>{' '}
                      {isMinorFromBirthDate(formBirthDate) ? (
                        <span style={{ color: 'var(--danger)', fontWeight: 700 }}> (18歳未満 / 年少者)</span>
                      ) : (
                        <span style={{ color: 'var(--success)', fontWeight: 600 }}> (一般スタッフ)</span>
                      )}
                    </div>
                  )}
                </div>

                <div className="form-group">
                  <label className="form-label">労基法年少者 (深夜業禁止)</label>
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                      height: '38px',
                      fontSize: '0.875rem',
                      cursor: 'pointer',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={formIsMinor}
                      onChange={(e) => setFormIsMinor(e.target.checked)}
                      style={{ width: '18px', height: '18px' }}
                    />
                    <span>18歳未満 (22時以降禁止)</span>
                  </label>
                </div>
              </div>

              {/* 年齢確認・在籍・留学生・母性保護フラグ (No. 204, 215, 267, 275) */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
                  gap: '0.5rem',
                  marginBottom: '1rem',
                  padding: '0.5rem',
                  backgroundColor: '#f8fafc',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border)',
                }}
              >
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.75rem', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={formAgeVerified}
                    onChange={(e) => setFormAgeVerified(e.target.checked)}
                  />
                  <span>年齢確認済 (身分証確認)</span>
                </label>

                <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.75rem', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={formIsActive}
                    onChange={(e) => setFormIsActive(e.target.checked)}
                  />
                  <span>在籍中 (有効)</span>
                </label>

                <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.75rem', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={formIsStudentVisa}
                    onChange={(e) => handleStudentVisaToggle(e.target.checked)}
                  />
                  <span>留学生 (週28h上限)</span>
                </label>

                <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.75rem', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={formIsPregnant}
                    onChange={(e) => setFormIsPregnant(e.target.checked)}
                  />
                  <span>母性保護 (妊婦・産後)</span>
                </label>
              </div>

              {/* 時給 (全角・カンマ自動変換対応: No. 202, 210) */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div className="form-group">
                  <label className="form-label">時給 (円 / 800〜10,000円)</label>
                  <input
                    type="text"
                    className="form-input"
                    value={formHourlyWageInput}
                    onChange={(e) => setFormHourlyWageInput(e.target.value)}
                    placeholder="例: 1200"
                    required
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">連続勤務上限日数 (1〜7日)</label>
                  <input
                    type="text"
                    className="form-input"
                    value={formMaxConsecutiveDaysInput}
                    onChange={(e) => setFormMaxConsecutiveDaysInput(e.target.value)}
                    placeholder="4"
                  />
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">保有ロール (複数選択可)</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                  {ROLE_OPTIONS.map((r) => (
                    <button
                      type="button"
                      key={r.id}
                      onClick={() => toggleRole(r.id)}
                      className={`btn btn-sm ${
                        formRoles.includes(r.id) ? 'btn-primary' : 'btn-secondary'
                      }`}
                    >
                      {formRoles.includes(r.id) ? '✓ ' : '+ '} {r.label}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div className="form-group">
                  <label className="form-label">
                    週間最大労働時間 (h){formIsStudentVisa && <span style={{ color: 'var(--danger)' }}> (留学生: 最大28h)</span>}
                  </label>
                  <input
                    type="text"
                    className="form-input"
                    value={formMaxWeeklyHoursInput}
                    onChange={(e) => setFormMaxWeeklyHoursInput(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">週間目標労働時間 (h)</label>
                  <input
                    type="text"
                    className="form-input"
                    value={formTargetWeeklyHoursInput}
                    onChange={(e) => setFormTargetWeeklyHoursInput(e.target.value)}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div className="form-group">
                  <label className="form-label">年収の壁（税・社会保険）</label>
                  <select
                    className="form-select"
                    value={formTaxWall || ''}
                    onChange={(e) =>
                      setFormTaxWall(e.target.value ? Number(e.target.value) : undefined)
                    }
                  >
                    <option value="">設定なし (制限なし)</option>
                    <option value="1030000">103万円 (所得税控除)</option>
                    <option value="1300000">130万円 (社会保険扶養)</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">今年度 累計収入 (円)</label>
                  <input
                    type="text"
                    className="form-input"
                    value={formYtdEarningsInput}
                    onChange={(e) => setFormYtdEarningsInput(e.target.value)}
                  />
                </div>
              </div>

              {/* NGペア設定 */}
              <div className="form-group">
                <label className="form-label">同時勤務NGスタッフ (相性制約)</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', maxHeight: '100px', overflowY: 'auto' }}>
                  {requestData.staff_members
                    .filter((s) => s.id !== formId)
                    .map((other) => (
                      <button
                        type="button"
                        key={other.id}
                        onClick={() => toggleNgStaff(other.id)}
                        className={`btn btn-sm ${
                          formNgStaffIds.includes(other.id) ? 'btn-danger' : 'btn-secondary'
                        }`}
                        style={{ fontSize: '0.75rem' }}
                      >
                        {formNgStaffIds.includes(other.id) ? '🚫 NG: ' : '+ '} {other.name.split(' ')[0]}
                      </button>
                    ))}
                </div>
              </div>

              {/* 希望ペア設定 */}
              <div className="form-group">
                <label className="form-label">同時勤務希望ペア (友人・ペア推奨)</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', maxHeight: '100px', overflowY: 'auto' }}>
                  {requestData.staff_members
                    .filter((s) => s.id !== formId)
                    .map((other) => (
                      <button
                        type="button"
                        key={other.id}
                        onClick={() => togglePreferredStaff(other.id)}
                        className={`btn btn-sm ${
                          formPreferredPartnerIds.includes(other.id) ? 'btn-primary' : 'btn-secondary'
                        }`}
                        style={{ fontSize: '0.75rem' }}
                      >
                        {formPreferredPartnerIds.includes(other.id) ? '🤝 ペア: ' : '+ '} {other.name.split(' ')[0]}
                      </button>
                    ))}
                </div>
              </div>

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'flex-end',
                  gap: '0.75rem',
                  marginTop: '1.25rem',
                  paddingTop: '1rem',
                  borderTop: '1px solid var(--border)',
                }}
              >
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="btn btn-secondary"
                >
                  キャンセル
                </button>
                <button type="submit" className="btn btn-primary" data-testid="btn-save-staff">
                  {editingStaff ? '変更を保存' : '登録する'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}
