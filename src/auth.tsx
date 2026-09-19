import { useEffect, useState } from 'react'
import { Mail, ShieldCheck } from 'lucide-react'
import { supabase } from './supabase'
import type { TelegramUser } from './telegram'
import './auth.css'

export function AuthScreen({telegramUser}:{telegramUser:TelegramUser|null}){
  const [email,setEmail]=useState('')
  const [sent,setSent]=useState(false)
  const [loading,setLoading]=useState(false)
  const [error,setError]=useState('')
  const [message,setMessage]=useState('')

  useEffect(()=>{
    if(!telegramUser){
      setError('Открой NUR_CHAT именно внутри Telegram, чтобы определить твой Telegram-профиль.')
      return
    }

    const finishProfile=async()=>{
      const {data}=await supabase.auth.getSession()
      const authUser=data.session?.user
      if(!authUser) return

      setLoading(true)
      const {error:profileError}=await supabase.from('profiles').upsert({
        id:authUser.id,
        telegram_id:telegramUser.id,
        username:telegramUser.username ?? null,
        first_name:telegramUser.first_name,
        last_name:telegramUser.last_name ?? null,
        photo_url:telegramUser.photo_url ?? null,
      })

      if(profileError){
        setError('Авторизация прошла, но профиль не сохранился: '+profileError.message)
      }else{
        await supabase.from('notifications').insert({
          user_id:authUser.id,
          title:'Добро пожаловать',
          text:'Твой профиль NUR_CHAT создан. Теперь можно общаться, добавлять друзей и отправлять подарки.',
          read:false
        })
      }
      setLoading(false)
    }

    finishProfile()

    const {data:{subscription}}=supabase.auth.onAuthStateChange((event)=>{
      if(event==='SIGNED_IN') finishProfile()
    })

    return()=>subscription.unsubscribe()
  },[telegramUser])

  const sendMagicLink=async()=>{
    const value=email.trim().toLowerCase()
    if(!value||!value.includes('@')){setError('Введи корректный email.');return}
    setLoading(true);setError('');setMessage('')
    const {error}=await supabase.auth.signInWithOtp({
      email:value,
      options:{
        shouldCreateUser:true,
        emailRedirectTo:window.location.origin
      }
    })
    setLoading(false)
    if(error){setError(error.message);return}
    setSent(true)
    setMessage('Ссылка для входа отправлена на почту. Открой письмо и нажми «Log In».')
  }

  return <div className="auth-shell"><div className="auth-card"><div className="auth-logo">N</div><span className="auth-kicker">NUR_CHAT · АВТОРИЗАЦИЯ</span><h1>Добро пожаловать</h1><p className="auth-subtitle">Вход привяжет твой NUR_CHAT-профиль к Telegram и подтвердит email.</p>{telegramUser&&<div className="auth-telegram"><div className="auth-avatar">{telegramUser.photo_url?<img src={telegramUser.photo_url} alt=""/>:telegramUser.first_name[0]}</div><div><strong>{telegramUser.first_name}{telegramUser.last_name?' '+telegramUser.last_name:''}</strong><span>{telegramUser.username?'@'+telegramUser.username:'Telegram ID '+telegramUser.id}</span></div></div>}<label>Email<input value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com" type="email" autoComplete="email" disabled={sent}/></label>{!sent?<button className="auth-button" onClick={sendMagicLink} disabled={loading||!telegramUser}><Mail size={17}/>{loading?'Отправляем…':'Получить ссылку'}</button>:<><div className="auth-message"><ShieldCheck size={17}/>Проверь почту и нажми кнопку входа в письме. После этого NUR_CHAT откроется автоматически.</div><button className="auth-link" onClick={()=>{setSent(false);setMessage('');setError('')}}>Изменить email</button></>} {message&&!sent&&<div className="auth-message">{message}</div>}{error&&<div className="auth-error">{error}</div>}<small className="auth-footnote">Мы используем Telegram только для профиля, а email — для подтверждения аккаунта.</small></div></div>
}
