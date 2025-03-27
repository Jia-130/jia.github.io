// 米雪大王的衣柜 - 完整JavaScript实现
// 版本：1.0.0 (2023-11-20)
// 功能：衣物管理、私有图片存储、分页筛选

// ==== 全局配置 ====
const CONFIG = {
  SUPABASE_URL: 'https://rwchfwvqqqwybdvdejgy.supabase.co',
  SUPABASE_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ3Y2hmd3ZxcXF3eWJkdmRlamd5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDI5NzI3NzUsImV4cCI6MjA1ODU0ODc3NX0.3qZ5fEKKGb_CU54sQ94T_J4fjymJFXQgAbc48TAzoAM',
  URL_EXPIRE_TIME: 3600,  // 签名URL有效期(秒)
  ITEMS_PER_PAGE: 12      // 每页显示数量
};

// ==== 全局变量 ====
let supabaseClient;       // Supabase客户端实例
let currentPage = 1;      // 当前页码
let totalItems = 0;       // 物品总数
let selectedImage = null; // 当前选中图片文件
let mainCategories = [];  // 分类数据
const imageUrlCache = new Map(); // 图片URL缓存

// ==== DOM元素缓存 ====
const dom = {
  authContainer: document.getElementById('auth-container'),
  appContent: document.getElementById('app-content'),
  loginEmail: document.getElementById('login-email'),
  loginPassword: document.getElementById('login-password'),
  loginBtn: document.getElementById('login-btn'),
  clothingName: document.getElementById('clothing-name'),
  mainCategorySelect: document.getElementById('main-category'),
  seasonSelect: document.getElementById('season-category'),
  clothingImageInput: document.getElementById('clothing-image'),
  uploadTrigger: document.getElementById('upload-trigger'),
  previewImg: document.getElementById('preview-img'),
  imagePreview: document.getElementById('image-preview'),
  addClothingBtn: document.getElementById('add-clothing'),
  wardrobeContainer: document.getElementById('wardrobe-container'),
  mainCategoryFilter: document.getElementById('main-category-filter'),
  seasonFilter: document.getElementById('season-filter'),
  clearFilterBtn: document.getElementById('clear-filter'),
  prevPageBtn: document.getElementById('prev-page'),
  nextPageBtn: document.getElementById('next-page'),
  pageInfo: document.getElementById('page-info'),
  imageModal: document.getElementById('image-modal'),
  modalImage: document.getElementById('modal-image'),
  statusElement: document.getElementById('session-status')
};

// ==== 初始化应用 ====
document.addEventListener('DOMContentLoaded', async () => {
  try {
    // 1. 初始化Supabase
    supabaseClient = supabase.createClient(
      CONFIG.SUPABASE_URL,
      CONFIG.SUPABASE_KEY,
      {
        auth: {
          autoRefreshToken: true,
          persistSession: true,
          detectSessionInUrl: true,
          flowType: 'pkce'
        }
      }
    );

    // 2. 检查现有会话
    const { data: { session }, error } = await supabaseClient.auth.getSession();
    if (error) throw error;

    if (session) {
      // 已登录状态
      dom.authContainer.style.display = 'none';
      dom.appContent.style.display = 'block';
      await loadMainCategories();
      await loadWardrobe();
    }

    // 3. 绑定事件
    bindEvents();

  } catch (err) {
    showError('应用初始化失败: ' + err.message);
    dom.authContainer.style.display = 'flex';
  }
});

// ==== 事件绑定 ====
function bindEvents() {
  // 图片上传
  dom.uploadTrigger.addEventListener('click', () => dom.clothingImageInput.click());
  dom.clothingImageInput.addEventListener('change', handleImageUpload);

  // 表单提交
  dom.addClothingBtn.addEventListener('click', addClothing);

  // 登录
  dom.loginBtn.addEventListener('click', handleLogin);

  // 筛选控制
  dom.mainCategoryFilter.addEventListener('change', filterWardrobe);
  dom.seasonFilter.addEventListener('change', filterWardrobe);
  dom.clearFilterBtn.addEventListener('click', clearFilter);

  // 分页
  dom.prevPageBtn.addEventListener('click', goToPrevPage);
  dom.nextPageBtn.addEventListener('click', goToNextPage);

  // 模态框关闭
  dom.imageModal.querySelector('button').addEventListener('click', () => {
    dom.imageModal.close();
  });
}

// ==== 核心功能实现 ====

/**
 * 处理图片上传预览
 */
function handleImageUpload(e) {
  const file = e.target.files[0];
  if (!file) return;

  selectedImage = file;

  const reader = new FileReader();
  reader.onload = (event) => {
    dom.previewImg.src = event.target.result;
    dom.previewImg.style.display = 'block';
    dom.imagePreview.querySelector('span').style.display = 'none';
  };
  reader.readAsDataURL(file);
}

/**
 * 图片压缩处理
 */
async function compressImage(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target.result;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        
        // 计算缩放比例
        const maxSize = 800;
        let width = img.width;
        let height = img.height;
        
        if (width > maxSize || height > maxSize) {
          const ratio = Math.min(maxSize / width, maxSize / height);
          width = width * ratio;
          height = height * ratio;
        }
        
        // 绘制压缩图像
        canvas.width = width;
        canvas.height = height;
        ctx.drawImage(img, 0, 0, width, height);
        
        // 转换为Blob
        canvas.toBlob((blob) => {
          resolve(new File([blob], file.name, {
            type: 'image/jpeg',
            lastModified: Date.now()
          }));
        }, 'image/jpeg', 0.7);
      };
    };
    reader.readAsDataURL(file);
  });
}

/**
 * 获取签名URL
 */
async function getSignedUrl(path) {
  // 检查缓存
  const cached = imageUrlCache.get(path);
  if (cached && cached.expiry > Date.now()) {
    return cached.url;
  }

  try {
    const { data, error } = await supabaseClient.storage
      .from('clothing-images')
      .createSignedUrl(path, CONFIG.URL_EXPIRE_TIME);

    if (error) throw error;

    // 更新缓存
    imageUrlCache.set(path, {
      url: data.signedUrl,
      expiry: Date.now() + (CONFIG.URL_EXPIRE_TIME * 900) // 提前10%过期
    });

    return data.signedUrl;
  } catch (err) {
    console.error('获取签名URL失败:', err);
    return '';
  }
}

// ==== 数据操作 ====

/**
 * 加载分类数据
 */
async function loadMainCategories() {
  try {
    showStatus('加载分类中...');
    const { data, error } = await supabaseClient
      .from('categories')
      .select('*')
      .order('name', { ascending: true });

    if (error) throw error;

    mainCategories = data;

    // 填充下拉菜单
    dom.mainCategorySelect.innerHTML = '<option value="">选择主分类</option>';
    dom.mainCategoryFilter.innerHTML = '<option value="all">所有分类</option>';

    data.forEach(category => {
      const option = document.createElement('option');
      option.value = category.name;
      option.textContent = category.name;
      dom.mainCategorySelect.appendChild(option);
      
      const filterOption = option.cloneNode(true);
      dom.mainCategoryFilter.appendChild(filterOption);
    });

  } catch (err) {
    showError('加载分类失败: ' + err.message);
  } finally {
    hideStatus();
  }
}

/**
 * 加载衣柜内容
 */
async function loadWardrobe() {
  try {
    showStatus('加载衣物中...');
    const userId = (await supabaseClient.auth.getUser()).data.user.id;

    // 构建查询
    let query = supabaseClient
      .from('clothing_items')
      .select('*', { count: 'exact' })
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .range(
        (currentPage - 1) * CONFIG.ITEMS_PER_PAGE,
        currentPage * CONFIG.ITEMS_PER_PAGE - 1
      );

    // 应用筛选
    if (dom.mainCategoryFilter.value !== 'all') {
      query = query.eq('main_category', dom.mainCategoryFilter.value);
    }
    if (dom.seasonFilter.value !== 'all') {
      query = query.eq('season', dom.seasonFilter.value);
    }

    const { data, count, error } = await query;
    if (error) throw error;

    totalItems = count || 0;
    updatePagination();

    // 清空容器
    dom.wardrobeContainer.innerHTML = '';

    // 处理空状态
    if (!data || data.length === 0) {
      const emptyMsg = document.createElement('p');
      emptyMsg.style.gridColumn = '1 / -1';
      emptyMsg.style.textAlign = 'center';
      emptyMsg.textContent = '没有找到衣物';
      dom.wardrobeContainer.appendChild(emptyMsg);
      return;
    }

    // 渲染衣物卡片
    for (const item of data) {
      const path = item.image_path.split('/').pop();
      const signedUrl = await getSignedUrl(path);

      const card = document.createElement('div');
      card.className = 'clothing-card';
      card.innerHTML = `
        <img src="${signedUrl}" 
             alt="${item.name}" 
             class="clothing-image"
             data-path="${path}"
             onclick="showOriginalImage('${item.original_image_path}')">
        <div class="clothing-info">
          <div class="clothing-name">${item.name}</div>
          <span class="clothing-category">${item.main_category}</span>
          <span class="clothing-season">${item.season}</span>
          <button class="delete-btn" data-id="${item.id}">删除</button>
        </div>
      `;

      // 绑定删除事件
      card.querySelector('.delete-btn').addEventListener('click', async () => {
        if (confirm('确定删除这件衣物吗？')) {
          await deleteClothing(item.id);
        }
      });

      dom.wardrobeContainer.appendChild(card);
    }

  } catch (err) {
    showError('加载失败: ' + err.message);
  } finally {
    hideStatus();
  }
}

/**
 * 添加衣物
 */
async function addClothing() {
  try {
    // 验证输入
    const name = dom.clothingName.value.trim();
    const category = dom.mainCategorySelect.value;
    const season = dom.seasonSelect.value;

    if (!name || !category || !season || !selectedImage) {
      showError('请填写完整信息并上传图片');
      return;
    }

    // 准备上传
    showStatus('上传中...');
    dom.addClothingBtn.disabled = true;

    // 压缩图片
    const compressedFile = await compressImage(selectedImage);
    const userId = (await supabaseClient.auth.getUser()).data.user.id;
    const timestamp = Date.now();
    const fileExt = selectedImage.name.split('.').pop();

    // 文件路径
    const originalPath = `${userId}/original_${timestamp}.${fileExt}`;
    const compressedPath = `${userId}/compressed_${timestamp}.${fileExt}`;

    // 上传文件
    const uploadTasks = [
      supabaseClient.storage.from('clothing-images').upload(originalPath, selectedImage),
      supabaseClient.storage.from('clothing-images').upload(compressedPath, compressedFile)
    ];

    const results = await Promise.all(uploadTasks);
    for (const result of results) {
      if (result.error) throw result.error;
    }

    // 获取分类ID
    const categoryData = mainCategories.find(c => c.name === category);
    if (!categoryData) throw new Error('无效分类');

    // 创建数据库记录
    const { error } = await supabaseClient.from('clothing_items').insert({
      user_id: userId,
      name: name,
      category_id: categoryData.id,
      main_category: category,
      season: season,
      image_path: compressedPath,
      original_image_path: originalPath
    });

    if (error) throw error;

    // 刷新显示
    await loadWardrobe();
    resetForm();

  } catch (err) {
    showError('添加失败: ' + err.message);
  } finally {
    dom.addClothingBtn.disabled = false;
    hideStatus();
  }
}

/**
 * 删除衣物
 */
async function deleteClothing(id) {
  try {
    showStatus('删除中...');

    // 获取衣物数据
    const { data: item, error: fetchError } = await supabaseClient
      .from('clothing_items')
      .select('image_path, original_image_path')
      .eq('id', id)
      .single();

    if (fetchError) throw fetchError;

    // 删除存储文件
    const deleteTasks = [
      supabaseClient.storage.from('clothing-images').remove([item.image_path]),
      supabaseClient.storage.from('clothing-images').remove([item.original_image_path])
    ];

    const results = await Promise.all(deleteTasks);
    for (const result of results) {
      if (result.error) throw result.error;
    }

    // 删除数据库记录
    const { error } = await supabaseClient
      .from('clothing_items')
      .delete()
      .eq('id', id);

    if (error) throw error;

    // 刷新显示
    await loadWardrobe();

  } catch (err) {
    showError('删除失败: ' + err.message);
  } finally {
    hideStatus();
  }
}

// ==== 辅助功能 ====

/**
 * 显示原图
 */
async function showOriginalImage(imagePath) {
  try {
    const path = imagePath.split('/').pop();
    const signedUrl = await getSignedUrl(path);
    dom.modalImage.src = signedUrl;
    dom.imageModal.showModal();
  } catch (err) {
    showError('无法加载图片: ' + err.message);
  }
}

/**
 * 筛选衣柜
 */
function filterWardrobe() {
  currentPage = 1;
  loadWardrobe();
}

/**
 * 清除筛选
 */
function clearFilter() {
  dom.mainCategoryFilter.value = 'all';
  dom.seasonFilter.value = 'all';
  currentPage = 1;
  loadWardrobe();
}

/**
 * 分页控制
 */
function goToPrevPage() {
  if (currentPage > 1) {
    currentPage--;
    loadWardrobe();
  }
}

function goToNextPage() {
  if (currentPage * CONFIG.ITEMS_PER_PAGE < totalItems) {
    currentPage++;
    loadWardrobe();
  }
}

function updatePagination() {
  const totalPages = Math.ceil(totalItems / CONFIG.ITEMS_PER_PAGE);
  dom.pageInfo.textContent = `第 ${currentPage} 页 / 共 ${totalPages} 页`;
  dom.prevPageBtn.disabled = currentPage <= 1;
  dom.nextPageBtn.disabled = currentPage >= totalPages;
}

/**
 * 重置表单
 */
function resetForm() {
  dom.clothingName.value = '';
  dom.mainCategorySelect.value = '';
  dom.seasonSelect.value = '';
  dom.clothingImageInput.value = '';
  dom.previewImg.src = '';
  dom.previewImg.style.display = 'none';
  dom.imagePreview.querySelector('span').style.display = 'block';
  selectedImage = null;
}

/**
 * 处理登录
 */
async function handleLogin() {
  try {
    const email = dom.loginEmail.value.trim();
    const password = dom.loginPassword.value.trim();

    if (!email || !password) {
      showError('请输入邮箱和密码');
      return;
    }

    showStatus('登录中...');
    dom.loginBtn.disabled = true;

    // 清除旧会话
    await supabaseClient.auth.signOut();

    // 新登录
    const { error } = await supabaseClient.auth.signInWithPassword({
      email,
      password
    });

    if (error) throw error;

    // 登录成功
    dom.authContainer.style.display = 'none';
    dom.appContent.style.display = 'block';
    await loadMainCategories();
    await loadWardrobe();

  } catch (err) {
    showError('登录失败: ' + err.message);
  } finally {
    dom.loginBtn.disabled = false;
    hideStatus();
  }
}

// ==== 工具函数 ====
function showStatus(message, isError = false) {
  if (dom.statusElement) {
    dom.statusElement.textContent = message;
    dom.statusElement.style.color = isError ? 'red' : '#666';
    dom.statusElement.style.display = 'block';
  }
  if (isError) console.error(message);
}

function showError(message) {
  showStatus(message, true);
}

function hideStatus() {
  if (dom.statusElement) {
    dom.statusElement.style.display = 'none';
  }
}

// 全局导出
window.showOriginalImage = showOriginalImage;