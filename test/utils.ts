import { BigNumber, Contract, ContractReceipt } from 'ethers'
import { ethers, network } from 'hardhat'

export type EventWithBigNumbers = Record<string, BigNumber>

export const calculateReceiptETHPaid = (receipt: ContractReceipt) => receipt.gasUsed.mul(receipt.effectiveGasPrice)

export const getEvents = (contract: Contract, receipt: ContractReceipt, eventName: string) => {
  const eventFragment = contract.interface.getEvent(eventName)
  const topic = contract.interface.getEventTopic(eventFragment)
  const decodedLogs = receipt.events
    ?.filter((event) => event.address === contract.address && event.topics.includes(topic))
    .map(event => contract.interface.decodeEventLog(eventName, event.data)) || []
  return decodedLogs
}

export const getETHBalance = async (address: string) => {
  return await ethers.provider.getBalance(address)
}

export const getEventsAmounts = (token: Contract, pool: Contract, receipt: ContractReceipt, eventName?: string) => {
  const transferEvents = getEvents(token, receipt, 'Transfer')
  const [eventTaxTransfer, eventTransfer] = transferEvents.length === 1 ? [unit(0), transferEvents[0]] : transferEvents
  const [secondEvent]: EventWithBigNumbers[] = eventName ? getEvents(pool, receipt, eventName) : []
  const amountNEWTax: BigNumber = !(eventTaxTransfer instanceof BigNumber) ? eventTaxTransfer.value : eventTaxTransfer
  const amountNEW: BigNumber = eventTransfer.value
  const amountNEWTotal = amountNEW.add(amountNEWTax)
  const amountETH = secondEvent ? secondEvent.amountETH : unit(0)
  return { amountETH, amountNEW, amountNEWTax, amountNEWTotal, secondEvent }
}

export const format = (num: BigNumber) => ethers.utils.formatUnits(num, 'ether')

export const setETHBalance = async (address: string, newBalance: BigNumber) => {
  await network.provider.send('hardhat_setBalance', [address, newBalance.toHexString().replace('0x0', '0x')])
}

export const unit = (num: number) => ethers.utils.parseEther(num.toString())
