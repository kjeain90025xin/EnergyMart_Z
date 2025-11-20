import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';
import { ethers } from 'ethers';

interface EnergyTrade {
  id: string;
  name: string;
  energyAmount: number;
  pricePerUnit: number;
  description: string;
  timestamp: number;
  creator: string;
  isVerified: boolean;
  decryptedValue?: number;
  encryptedValueHandle?: string;
}

interface TradeStats {
  totalEnergy: number;
  completedTrades: number;
  avgPrice: number;
  userEarnings: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [trades, setTrades] = useState<EnergyTrade[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingTrade, setCreatingTrade] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newTradeData, setNewTradeData] = useState({ 
    name: "", 
    energyAmount: "", 
    pricePerUnit: "",
    description: ""
  });
  const [selectedTrade, setSelectedTrade] = useState<EnergyTrade | null>(null);
  const [decryptedData, setDecryptedData] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [activeTab, setActiveTab] = useState("trades");
  const [searchTerm, setSearchTerm] = useState("");

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected) return;
      if (isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadData();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const loadData = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const tradesList: EnergyTrade[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          tradesList.push({
            id: businessId,
            name: businessData.name,
            energyAmount: Number(businessData.publicValue1) || 0,
            pricePerUnit: Number(businessData.publicValue2) || 0,
            description: businessData.description,
            timestamp: Number(businessData.timestamp),
            creator: businessData.creator,
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading trade data:', e);
        }
      }
      
      setTrades(tradesList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const createTrade = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingTrade(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating energy trade with FHE encryption..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const energyValue = parseInt(newTradeData.energyAmount) || 0;
      const businessId = `energy-trade-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, energyValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newTradeData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        energyValue,
        parseInt(newTradeData.pricePerUnit) || 0,
        newTradeData.description
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Energy trade created successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewTradeData({ name: "", energyAmount: "", pricePerUnit: "", description: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingTrade(false); 
    }
  };

  const decryptData = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    setIsDecrypting(true);
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Data already verified on-chain" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption on-chain..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadData();
      
      setTransactionStatus({ visible: true, status: "success", message: "Energy data decrypted successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Data is already verified on-chain" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        await loadData();
        return null;
      }
      
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "Decryption failed: " + (e.message || "Unknown error") 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const testAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      setTransactionStatus({ 
        visible: true, 
        status: "success", 
        message: "Contract is available and responding!" 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Contract test failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const getTradeStats = (): TradeStats => {
    const filteredTrades = trades.filter(trade => 
      trade.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      trade.description.toLowerCase().includes(searchTerm.toLowerCase())
    );

    const totalEnergy = filteredTrades.reduce((sum, trade) => sum + trade.energyAmount, 0);
    const completedTrades = filteredTrades.filter(trade => trade.isVerified).length;
    const avgPrice = filteredTrades.length > 0 
      ? filteredTrades.reduce((sum, trade) => sum + trade.pricePerUnit, 0) / filteredTrades.length 
      : 0;
    
    const userTrades = filteredTrades.filter(trade => trade.creator === address);
    const userEarnings = userTrades.reduce((sum, trade) => sum + (trade.energyAmount * trade.pricePerUnit), 0);

    return { totalEnergy, completedTrades, avgPrice, userEarnings };
  };

  const renderStats = () => {
    const stats = getTradeStats();
    const filteredTrades = trades.filter(trade => 
      trade.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      trade.description.toLowerCase().includes(searchTerm.toLowerCase())
    );

    return (
      <div className="stats-grid">
        <div className="stat-card neon-purple">
          <div className="stat-icon">⚡</div>
          <div className="stat-content">
            <h3>Total Energy</h3>
            <div className="stat-value">{stats.totalEnergy} kWh</div>
            <div className="stat-label">FHE Encrypted</div>
          </div>
        </div>
        
        <div className="stat-card neon-blue">
          <div className="stat-icon">🔄</div>
          <div className="stat-content">
            <h3>Completed Trades</h3>
            <div className="stat-value">{stats.completedTrades}/{filteredTrades.length}</div>
            <div className="stat-label">Verified Transactions</div>
          </div>
        </div>
        
        <div className="stat-card neon-pink">
          <div className="stat-icon">💰</div>
          <div className="stat-content">
            <h3>Avg Price</h3>
            <div className="stat-value">${stats.avgPrice.toFixed(2)}</div>
            <div className="stat-label">Per kWh</div>
          </div>
        </div>
        
        <div className="stat-card neon-green">
          <div className="stat-icon">👤</div>
          <div className="stat-content">
            <h3>Your Earnings</h3>
            <div className="stat-value">${stats.userEarnings.toFixed(2)}</div>
            <div className="stat-label">Total Revenue</div>
          </div>
        </div>
      </div>
    );
  };

  const renderEnergyChart = () => {
    const recentTrades = trades.slice(-5).reverse();
    
    return (
      <div className="energy-chart">
        <h3>Recent Energy Trades</h3>
        <div className="chart-bars">
          {recentTrades.map((trade, index) => (
            <div key={trade.id} className="chart-bar-container">
              <div className="chart-bar-label">{trade.name}</div>
              <div className="chart-bar">
                <div 
                  className="bar-fill neon-gradient"
                  style={{ height: `${Math.min(100, (trade.energyAmount / 100) * 100)}%` }}
                >
                  <span className="bar-value">{trade.energyAmount}kWh</span>
                </div>
              </div>
              <div className="chart-bar-price">${trade.pricePerUnit}</div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderFAQ = () => {
    return (
      <div className="faq-section">
        <h3>FHE Energy Trading FAQ</h3>
        <div className="faq-list">
          <div className="faq-item">
            <div className="faq-question">How does FHE protect my energy data?</div>
            <div className="faq-answer">Your energy production and consumption data is encrypted using Fully Homomorphic Encryption, allowing computations without revealing actual values.</div>
          </div>
          <div className="faq-item">
            <div className="faq-question">Is my lifestyle pattern secure?</div>
            <div className="faq-answer">Yes! FHE ensures that your daily energy patterns remain private while still enabling efficient P2P energy trading with neighbors.</div>
          </div>
          <div className="faq-item">
            <div className="faq-question">How are trades matched automatically?</div>
            <div className="faq-answer">Our system uses homomorphic computations to match energy supply and demand without decrypting sensitive personal data.</div>
          </div>
        </div>
      </div>
    );
  };

  const filteredTrades = trades.filter(trade => 
    trade.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    trade.description.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>EnergyMart_Z ⚡</h1>
            <span className="tagline">Private Energy Trading with FHE</span>
          </div>
          <div className="header-actions">
            <div className="wallet-connect-wrapper">
              <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
            </div>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">🔐⚡</div>
            <h2>Connect Your Wallet to Start Trading</h2>
            <p>Join the private energy marketplace where your data stays encrypted with Fully Homomorphic Encryption.</p>
            <div className="connection-steps">
              <div className="step">
                <span>1</span>
                <p>Connect your wallet to initialize FHE system</p>
              </div>
              <div className="step">
                <span>2</span>
                <p>Trade solar energy with neighbors privately</p>
              </div>
              <div className="step">
                <span>3</span>
                <p>Earn while keeping your lifestyle patterns secure</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>Initializing FHE Encryption System...</p>
        <p className="loading-note">Securing your energy data with Zama FHE</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading encrypted energy marketplace...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>EnergyMart_Z ⚡</h1>
          <span className="tagline">FHE-Protected Energy Trading</span>
        </div>
        
        <div className="header-actions">
          <button onClick={testAvailability} className="test-btn">
            Test Contract
          </button>
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-btn"
          >
            + New Trade
          </button>
          <div className="wallet-connect-wrapper">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </div>
      </header>

      <nav className="app-nav">
        <button 
          className={`nav-btn ${activeTab === "trades" ? "active" : ""}`}
          onClick={() => setActiveTab("trades")}
        >
          Energy Trades
        </button>
        <button 
          className={`nav-btn ${activeTab === "stats" ? "active" : ""}`}
          onClick={() => setActiveTab("stats")}
        >
          Statistics
        </button>
        <button 
          className={`nav-btn ${activeTab === "faq" ? "active" : ""}`}
          onClick={() => setActiveTab("faq")}
        >
          FAQ
        </button>
      </nav>
      
      <div className="main-content">
        {activeTab === "trades" && (
          <div className="trades-section">
            <div className="section-header">
              <h2>Available Energy Trades</h2>
              <div className="search-bar">
                <input 
                  type="text"
                  placeholder="Search trades..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="search-input"
                />
              </div>
              <div className="header-actions">
                <button onClick={loadData} className="refresh-btn" disabled={isRefreshing}>
                  {isRefreshing ? "🔄" : "Refresh"}
                </button>
              </div>
            </div>
            
            <div className="trades-list">
              {filteredTrades.length === 0 ? (
                <div className="no-trades">
                  <p>No energy trades found</p>
                  <button className="create-btn" onClick={() => setShowCreateModal(true)}>
                    Create First Trade
                  </button>
                </div>
              ) : filteredTrades.map((trade) => (
                <div 
                  className={`trade-item ${selectedTrade?.id === trade.id ? "selected" : ""}`}
                  key={trade.id}
                  onClick={() => setSelectedTrade(trade)}
                >
                  <div className="trade-header">
                    <div className="trade-title">{trade.name}</div>
                    <div className={`trade-status ${trade.isVerified ? "verified" : "pending"}`}>
                      {trade.isVerified ? "✅ Verified" : "🔒 Encrypted"}
                    </div>
                  </div>
                  <div className="trade-details">
                    <span>Energy: {trade.energyAmount} kWh</span>
                    <span>Price: ${trade.pricePerUnit}/kWh</span>
                    <span>{new Date(trade.timestamp * 1000).toLocaleDateString()}</span>
                  </div>
                  <div className="trade-description">{trade.description}</div>
                  <div className="trade-creator">
                    From: {trade.creator.substring(0, 6)}...{trade.creator.substring(38)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === "stats" && (
          <div className="stats-section">
            <h2>Energy Trading Statistics</h2>
            {renderStats()}
            {renderEnergyChart()}
          </div>
        )}

        {activeTab === "faq" && (
          <div className="faq-tab">
            <h2>Frequently Asked Questions</h2>
            {renderFAQ()}
          </div>
        )}
      </div>
      
      {showCreateModal && (
        <ModalCreateTrade 
          onSubmit={createTrade} 
          onClose={() => setShowCreateModal(false)} 
          creating={creatingTrade} 
          tradeData={newTradeData} 
          setTradeData={setNewTradeData}
          isEncrypting={isEncrypting}
        />
      )}
      
      {selectedTrade && (
        <TradeDetailModal 
          trade={selectedTrade} 
          onClose={() => { 
            setSelectedTrade(null); 
            setDecryptedData(null); 
          }} 
          decryptedData={decryptedData} 
          setDecryptedData={setDecryptedData} 
          isDecrypting={isDecrypting || fheIsDecrypting} 
          decryptData={() => decryptData(selectedTrade.id)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="fhe-spinner"></div>}
              {transactionStatus.status === "success" && <div className="success-icon">✓</div>}
              {transactionStatus.status === "error" && <div className="error-icon">✗</div>}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
    </div>
  );
};

const ModalCreateTrade: React.FC<{
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  tradeData: any;
  setTradeData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, tradeData, setTradeData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    if (name === 'energyAmount' || name === 'pricePerUnit') {
      const intValue = value.replace(/[^\d]/g, '');
      setTradeData({ ...tradeData, [name]: intValue });
    } else {
      setTradeData({ ...tradeData, [name]: value });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="create-trade-modal">
        <div className="modal-header">
          <h2>New Energy Trade</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <strong>FHE 🔐 Energy Encryption</strong>
            <p>Your energy amount will be encrypted with Zama FHE to protect your lifestyle patterns</p>
          </div>
          
          <div className="form-group">
            <label>Trade Name *</label>
            <input 
              type="text" 
              name="name" 
              value={tradeData.name} 
              onChange={handleChange} 
              placeholder="e.g., Morning Solar Surplus" 
            />
          </div>
          
          <div className="form-group">
            <label>Energy Amount (kWh, Integer only) *</label>
            <input 
              type="number" 
              name="energyAmount" 
              value={tradeData.energyAmount} 
              onChange={handleChange} 
              placeholder="Enter energy amount..." 
              step="1"
              min="0"
            />
            <div className="data-type-label">FHE Encrypted Integer</div>
          </div>
          
          <div className="form-group">
            <label>Price per kWh ($) *</label>
            <input 
              type="number" 
              name="pricePerUnit" 
              value={tradeData.pricePerUnit} 
              onChange={handleChange} 
              placeholder="Enter price..." 
              step="0.01"
              min="0"
            />
            <div className="data-type-label">Public Data</div>
          </div>
          
          <div className="form-group">
            <label>Description</label>
            <textarea 
              name="description" 
              value={tradeData.description} 
              onChange={handleChange} 
              placeholder="Describe your energy trade..."
              rows={3}
            />
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button 
            onClick={onSubmit} 
            disabled={creating || isEncrypting || !tradeData.name || !tradeData.energyAmount || !tradeData.pricePerUnit} 
            className="submit-btn"
          >
            {creating || isEncrypting ? "Encrypting and Creating..." : "Create Trade"}
          </button>
        </div>
      </div>
    </div>
  );
};

const TradeDetailModal: React.FC<{
  trade: EnergyTrade;
  onClose: () => void;
  decryptedData: number | null;
  setDecryptedData: (value: number | null) => void;
  isDecrypting: boolean;
  decryptData: () => Promise<number | null>;
}> = ({ trade, onClose, decryptedData, setDecryptedData, isDecrypting, decryptData }) => {
  const handleDecrypt = async () => {
    if (decryptedData !== null) { 
      setDecryptedData(null); 
      return; 
    }
    
    const decrypted = await decryptData();
    if (decrypted !== null) {
      setDecryptedData(decrypted);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="trade-detail-modal">
        <div className="modal-header">
          <h2>Energy Trade Details</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="trade-info">
            <div className="info-item">
              <span>Trade Name:</span>
              <strong>{trade.name}</strong>
            </div>
            <div className="info-item">
              <span>Creator:</span>
              <strong>{trade.creator.substring(0, 6)}...{trade.creator.substring(38)}</strong>
            </div>
            <div className="info-item">
              <span>Date Created:</span>
              <strong>{new Date(trade.timestamp * 1000).toLocaleDateString()}</strong>
            </div>
            <div className="info-item">
              <span>Price per kWh:</span>
              <strong>${trade.pricePerUnit}</strong>
            </div>
            <div className="info-item">
              <span>Description:</span>
              <div className="description-text">{trade.description}</div>
            </div>
          </div>
          
          <div className="data-section">
            <h3>Encrypted Energy Data</h3>
            
            <div className="data-row">
              <div className="data-label">Energy Amount:</div>
              <div className="data-value">
                {trade.isVerified && trade.decryptedValue ? 
                  `${trade.decryptedValue} kWh (On-chain Verified)` : 
                  decryptedData !== null ? 
                  `${decryptedData} kWh (Locally Decrypted)` : 
                  "🔒 FHE Encrypted kWh"
                }
              </div>
              <button 
                className={`decrypt-btn ${(trade.isVerified || decryptedData !== null) ? 'decrypted' : ''}`}
                onClick={handleDecrypt} 
                disabled={isDecrypting}
              >
                {isDecrypting ? (
                  "🔓 Verifying..."
                ) : trade.isVerified ? (
                  "✅ Verified"
                ) : decryptedData !== null ? (
                  "🔄 Re-verify"
                ) : (
                  "🔓 Verify Decryption"
                )}
              </button>
            </div>
            
            <div className="fhe-info">
              <div className="fhe-icon">🔐⚡</div>
              <div>
                <strong>FHE-Protected Energy Trading</strong>
                <p>Your energy production data is encrypted on-chain. Verify to decrypt and confirm the trade amount while keeping your patterns private.</p>
              </div>
            </div>
          </div>
          
          {(trade.isVerified || decryptedData !== null) && (
            <div className="trade-summary">
              <h3>Trade Summary</h3>
              <div className="summary-grid">
                <div className="summary-item">
                  <span>Energy Amount:</span>
                  <strong>
                    {trade.isVerified ? trade.decryptedValue : decryptedData} kWh
                  </strong>
                </div>
                <div className="summary-item">
                  <span>Unit Price:</span>
                  <strong>${trade.pricePerUnit}</strong>
                </div>
                <div className="summary-item total">
                  <span>Total Value:</span>
                  <strong>
                    ${((trade.isVerified ? trade.decryptedValue : decryptedData || 0) * trade.pricePerUnit).toFixed(2)}
                  </strong>
                </div>
              </div>
            </div>
          )}
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">Close</button>
          {!trade.isVerified && (
            <button 
              onClick={handleDecrypt} 
              disabled={isDecrypting}
              className="verify-btn"
            >
              {isDecrypting ? "Verifying on-chain..." : "Verify Trade"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;


