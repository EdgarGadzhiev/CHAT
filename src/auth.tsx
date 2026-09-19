import { useEffect, useState } from 'react'
import { Mail, ShieldCheck } from 'lucide-react'
import { supabase } from './supabase'
import type { TelegramUser } from './telegram'
import './auth.css'

export function AuthScreen({telegramUser}:{telegramUser:TelegramUser|null}){
  const [email,setEmail]=useState('')
  const [code,setCode]=useState('')
  const [sent,setSent]=useState(false)
  const [loading,setLoading]=useState(false)
  const [error,setError]=useState('')
  const [message,setMessage]=useState('')

  useEffect(()=>{
    if(!telegramUser) setError('Открой NUR_CHAT именно внутри Telegram, чтобы определить твой Telegram-профиль.')
  },[telegramUser])

  const sendCode=async()=>{
    const value=email.trim().toLowerCase()
    if(!value||!value.includes('@')){setError('Введи корректный email.');return}
    setLoading(true);setError('');setMessage('')
    const {error}=await supabase.auth.signInWithOtp({email:value,options:{shouldCreateUser:true}})
    setLoading(false)
    if(error){setError(error.message);return}
    setSent(true);setMessage('Код отправлен на почту. Проверь входящие и папку «Спам».')
  }

  const verify=async()=>{
    const value=email.trim().toLowerCase(); const token=code.replace(/\\D/g,'')
    if(token.length!==6){setError('Введи 6-значный код из письма.');return}
    if(!telegramUser){setError('Telegram-профиль не найден. Открой приложение из Telegram.');return}
    setLoading(true);setError('')
    const {data,error}=await supabase.auth.verifyOtp({email:value,token,type:'email'})
    if(error){setLoading(false);setError(error.message);return}
    const authUser=data.user
    if(!authUser){setLoading(false);setError('Не удалось получить пользователя.');return}
    const {error:profileError}=await supabase.from('profiles').upsert({
      id:authUser.id,
      telegram_id:telegramUser.id,
      username:telegramUser.username ?? null,
      first_name:telegramUser.first_name,
      last_name:telegramUser.last_name ?? null,
      photo_url:telegramUser.photo_url ?? null,
    })
    if(profileError){setLoading(false);setError('Авторизация прошла, но профиль не сохранился: '+profileError.message);return}
    await supabase.from('notifications').insert({user_id:authUser.id,title:'Добро пожаловать',text:'Твой профиль NUR_CHAT создан. Теперь можно общаться, добавлять друзей и отправлять подарки.',read:false})
    setLoading(false)
  }

  return <div className="auth-shell"><div className="auth-card"><div className="auth-logo">N</div><span className="auth-kicker">NUR_CHAT · АВТОРИЗАЦИЯ</span><h1>Добро пожаловать</h1><p className="auth-subtitle">Вход привяжет твой NUR_CHAT-профиль к Telegram и подтвердит email.</p>{telegramUser&&<div className="auth-telegram"><div className="auth-avatar">{telegramUser.photo_url?<img src={telegramUser.photo_url} alt=""/>:telegramUser.first_name[0]}</div><div><strong>{telegramUser.first_name}{telegramUser.last_name?' '+telegramUser.last_name:''}</strong><span>{telegramUser.username?'@'+telegramUser.username:'Telegram ID '+telegramUser.id}</span></div></div>}<label>Email<input value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com" type="email" autoComplete="email" disabled={sent}/></label>{!sent?<button className="auth-button" onClick={sendCode} disabled={loading||!telegramUser}><Mail size={17}/>{loading?'Отправляем…':'Получить код'}</button>:<><label>Код из письма<input value={code} onChange={e=>setCode(e.target.value.replace(/\\D/g,'').slice(0,6))} placeholder="123456" inputMode="numeric" autoComplete="one-time-code" autoFocus/></label><button className="auth-button" onClick={verify} disabled={loading}><ShieldCheck size={17}/>{loading?'Проверяем…':'Подтвердить и войти'}</button><button className="auth-link" onClick={()=>{setSent(false);setCode('');setMessage('')}}>Изменить email</button></>} {message&&<div className="auth-message">{message}</div>}{error&&<div className="auth-error">{error}</div>}<small className="auth-footnote">Мы используем Telegram только для профиля, а email — для подтверждения аккаунта.</small></div></div>
}
