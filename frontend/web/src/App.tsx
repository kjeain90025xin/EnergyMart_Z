import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';

interface EnergyTrade {
  id: string;
  name: string;
  encryptedEnergy: string;
  price: number;
  timestamp: number;
  creator: string;
  publicValue1: number;
  publicValue2: number;
  isVerified?: boolean;
  decryptedValue?: number;
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
  const [newTradeData, setNewTradeData] = useState({ name: "", energy: "", price: "" });
  const [selectedTrade, setSelectedTrade] = useState<EnergyTrade | null>(null);
  const [decryptedEnergy, setDecryptedEnergy] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterVerified, setFilterVerified] = useState(false);

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected || isInitialized || fhevmInitializing) return;
      
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
            encryptedEnergy: businessId,
            price: Number(businessData.publicValue1) || 0,
            timestamp: Number(businessData.timestamp),
            creator: businessData.creator,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading business data:', e);
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
    setTransactionStatus({ visible: true, status: "pending", message: "Creating energy trade with FHE..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const energyValue = parseInt(newTradeData.energy) || 0;
      const businessId = `energy-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, energyValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newTradeData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        parseInt(newTradeData.price) || 0,
        0,
        "Solar Energy Trade"
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Energy trade created successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewTradeData({ name: "", energy: "", price: "" });
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
        setTransactionStatus({ visible: true, status: "success", message: "Data already verified on-chain" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
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
        setTransactionStatus({ visible: true, status: "success", message: "Data is already verified on-chain" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        await loadData();
        return null;
      }
      
      setTransactionStatus({ visible: true, status: "error", message: "Decryption failed: " + (e.message || "Unknown error") });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      setTransactionStatus({ visible: true, status: "success", message: "Contract is available and ready!" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Availability check failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const filteredTrades = trades.filter(trade => {
    const matchesSearch = trade.name.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesFilter = !filterVerified || trade.isVerified;
    return matchesSearch && matchesFilter;
  });

  const totalEnergy = filteredTrades.reduce((sum, trade) => {
    const energy = trade.isVerified ? (trade.decryptedValue || 0) : 0;
    return sum + energy;
  }, 0);

  const avgPrice = filteredTrades.length > 0 
    ? filteredTrades.reduce((sum, trade) => sum + trade.price, 0) / filteredTrades.length 
    : 0;

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>🌞 EnergyMart_Z 🔐</h1>
          </div>
          <div className="header-actions">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">🔐</div>
            <h2>Connect Wallet to Access Private Energy Market</h2>
            <p>Join the FHE-protected solar energy trading platform</p>
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
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading energy market...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>🌞 EnergyMart_Z 🔐</h1>
          <p>Private Solar Energy Trading</p>
        </div>
        
        <div className="header-actions">
          <button onClick={checkAvailability} className="check-btn">
            Check Contract
          </button>
          <button onClick={() => setShowCreateModal(true)} className="create-btn">
            + Sell Energy
          </button>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </div>
      </header>
      
      <div className="main-content">
        <div className="stats-panel">
          <div className="stat-card">
            <h3>Total Energy</h3>
            <div className="stat-value">{totalEnergy} kWh</div>
            <div className="stat-label">FHE Protected</div>
          </div>
          <div className="stat-card">
            <h3>Active Trades</h3>
            <div className="stat-value">{filteredTrades.length}</div>
            <div className="stat-label">On Market</div>
          </div>
          <div className="stat-card">
            <h3>Avg Price</h3>
            <div className="stat-value">${avgPrice.toFixed(2)}</div>
            <div className="stat-label">Per kWh</div>
          </div>
        </div>

        <div className="search-filters">
          <div className="search-box">
            <input 
              type="text" 
              placeholder="Search energy trades..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <div className="filters">
            <label>
              <input 
                type="checkbox" 
                checked={filterVerified}
                onChange={(e) => setFilterVerified(e.target.checked)}
              />
              Verified Only
            </label>
            <button onClick={loadData} disabled={isRefreshing}>
              {isRefreshing ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>

        <div className="trades-list">
          {filteredTrades.length === 0 ? (
            <div className="no-trades">
              <p>No energy trades found</p>
              <button onClick={() => setShowCreateModal(true)}>
                Create First Trade
              </button>
            </div>
          ) : filteredTrades.map((trade, index) => (
            <div 
              className={`trade-item ${selectedTrade?.id === trade.id ? "selected" : ""}`} 
              key={index}
              onClick={() => setSelectedTrade(trade)}
            >
              <div className="trade-header">
                <div className="trade-name">{trade.name}</div>
                <div className={`trade-status ${trade.isVerified ? "verified" : "pending"}`}>
                  {trade.isVerified ? "✅ Verified" : "🔓 Encrypted"}
                </div>
              </div>
              <div className="trade-details">
                <span>Price: ${trade.price}/kWh</span>
                <span>Created: {new Date(trade.timestamp * 1000).toLocaleDateString()}</span>
              </div>
              <div className="trade-energy">
                Energy: {trade.isVerified ? `${trade.decryptedValue} kWh` : "🔒 FHE Encrypted"}
              </div>
            </div>
          ))}
        </div>
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
            setDecryptedEnergy(null); 
          }} 
          decryptedEnergy={decryptedEnergy} 
          setDecryptedEnergy={setDecryptedEnergy} 
          isDecrypting={isDecrypting || fheIsDecrypting} 
          decryptData={() => decryptData(selectedTrade.id)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="fhe-spinner"></div>}
              {transactionStatus.status === "success" && "✓"}
              {transactionStatus.status === "error" && "✗"}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}

      <footer className="app-footer">
        <p>EnergyMart_Z - FHE Protected Solar Energy Trading Platform</p>
      </footer>
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
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    if (name === 'energy') {
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
          <h2>Sell Solar Energy</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <strong>FHE 🔐 Energy Encryption</strong>
            <p>Your energy data will be encrypted with Zama FHE</p>
          </div>
          
          <div className="form-group">
            <label>Trade Name *</label>
            <input 
              type="text" 
              name="name" 
              value={tradeData.name} 
              onChange={handleChange} 
              placeholder="Enter trade name..." 
            />
          </div>
          
          <div className="form-group">
            <label>Energy Amount (kWh) *</label>
            <input 
              type="number" 
              name="energy" 
              value={tradeData.energy} 
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
              name="price" 
              value={tradeData.price} 
              onChange={handleChange} 
              placeholder="Enter price..." 
              step="0.01"
              min="0"
            />
            <div className="data-type-label">Public Data</div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button 
            onClick={onSubmit} 
            disabled={creating || isEncrypting || !tradeData.name || !tradeData.energy || !tradeData.price} 
            className="submit-btn"
          >
            {creating || isEncrypting ? "Encrypting..." : "Create Trade"}
          </button>
        </div>
      </div>
    </div>
  );
};

const TradeDetailModal: React.FC<{
  trade: EnergyTrade;
  onClose: () => void;
  decryptedEnergy: number | null;
  setDecryptedEnergy: (value: number | null) => void;
  isDecrypting: boolean;
  decryptData: () => Promise<number | null>;
}> = ({ trade, onClose, decryptedEnergy, setDecryptedEnergy, isDecrypting, decryptData }) => {
  const handleDecrypt = async () => {
    if (decryptedEnergy !== null) { 
      setDecryptedEnergy(null); 
      return; 
    }
    
    const decrypted = await decryptData();
    if (decrypted !== null) {
      setDecryptedEnergy(decrypted);
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
              <strong>${trade.price}</strong>
            </div>
          </div>
          
          <div className="data-section">
            <h3>Encrypted Energy Data</h3>
            
            <div className="data-row">
              <div className="data-label">Energy Amount:</div>
              <div className="data-value">
                {trade.isVerified ? 
                  `${trade.decryptedValue} kWh (Verified)` : 
                  decryptedEnergy !== null ? 
                  `${decryptedEnergy} kWh (Decrypted)` : 
                  "🔒 FHE Encrypted"
                }
              </div>
              <button 
                className={`decrypt-btn ${(trade.isVerified || decryptedEnergy !== null) ? 'decrypted' : ''}`}
                onClick={handleDecrypt} 
                disabled={isDecrypting}
              >
                {isDecrypting ? "Decrypting..." : trade.isVerified ? "✅ Verified" : decryptedEnergy !== null ? "🔄 Re-decrypt" : "🔓 Decrypt"}
              </button>
            </div>
          </div>
          
          {(trade.isVerified || decryptedEnergy !== null) && (
            <div className="analysis-section">
              <h3>Trade Analysis</h3>
              <div className="analysis-grid">
                <div className="analysis-item">
                  <span>Total Value:</span>
                  <strong>${((trade.isVerified ? trade.decryptedValue! : decryptedEnergy!) * trade.price).toFixed(2)}</strong>
                </div>
                <div className="analysis-item">
                  <span>Carbon Saved:</span>
                  <strong>{((trade.isVerified ? trade.decryptedValue! : decryptedEnergy!) * 0.5).toFixed(1)} kg</strong>
                </div>
              </div>
            </div>
          )}
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">Close</button>
        </div>
      </div>
    </div>
  );
};

export default App;